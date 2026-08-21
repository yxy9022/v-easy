import { spawn } from 'child_process'
import ffmpegPath from './ffmpeg'

let processing = false

/** 执行 ffmpeg，通过 stdout 的 -progress 输出回调进度（秒） */
function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args)
    let stderr = ''
    proc.stdout.on('data', (buf) => {
      if (!onProgress) return
      const match = buf.toString().match(/out_time=(\d+):(\d+):(\d+)\.(\d+)/)
      if (match) {
        const sec =
          Number(match[1]) * 3600 +
          Number(match[2]) * 60 +
          Number(match[3]) +
          Number(match[4].slice(0, 3)) / 1000
        onProgress(sec)
      }
    })
    proc.stderr.on('data', (buf) => {
      stderr += buf.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else
        reject(new Error(stderr.split('\n').slice(-8).join('\n').trim() || `ffmpeg 退出码 ${code}`))
    })
  })
}

/** 探测单个视频基本信息（分辨率、帧率、时长、是否有音轨），通过 ffmpeg -i 的 stderr 输出解析 */
function probeVideo(inputPath) {
  return new Promise((resolve, reject) => {
    // -c copy 不解码，-f null - 指定空输出，避免 "At least one output file must be specified" 干扰
    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-i',
      inputPath,
      '-c',
      'copy',
      '-f',
      'null',
      '-'
    ])
    let stderr = ''
    proc.stderr.on('data', (buf) => {
      stderr += buf.toString()
    })
    proc.on('error', reject)
    proc.on('close', () => {
      const info = { width: 0, height: 0, fps: 0, duration: 0, hasAudio: false }

      const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (dur) info.duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])

      for (const line of stderr.split('\n')) {
        if (line.includes('Video:')) {
          // 分辨率至少两位数，避免匹配到 codec fourcc 如 0x31637661
          const res = line.match(/(\d{2,})x(\d{2,})/)
          if (res) {
            info.width = Number(res[1])
            info.height = Number(res[2])
          }
          const fps = line.match(/(\d+(?:\.\d+)?)\s*fps/)
          if (fps) info.fps = Number(fps[1])
        }
        if (line.includes('Audio:')) info.hasAudio = true
      }

      if (!info.width || !info.height) {
        const tail = stderr.split('\n').slice(-8).join('\n').trim()
        reject(
          new Error(
            tail.includes('Invalid data found')
              ? '文件无法识别为视频：' + tail
              : '未找到视频流，可能该文件没有画面或格式不受支持：' + tail
          )
        )
        return
      }
      resolve(info)
    })
  })
}

/**
 * 主入口：按顺序合并多个视频
 * - inputPaths 为视频路径数组，至少 2 个
 * - 自动探测各视频规格：分辨率统一为最大尺寸（居中补齐），帧率统一为最高帧率，
 *   音频统一为 48kHz 立体声；无音轨的视频自动补静音轨，保证合并结果音轨完整
 * - 进度通过 event.sender 回传渲染进程
 */
export async function mergeVideos(event, { inputPaths, outputPath }) {
  if (processing) throw new Error('已有合并任务正在进行，请等待完成')

  if (!Array.isArray(inputPaths) || inputPaths.length < 2) {
    throw new Error('请至少选择 2 个视频')
  }

  processing = true
  const send = (percent, message) => {
    event.sender.send('merge:progress', { percent, message })
  }

  try {
    send(2, '正在分析视频...')

    // 1. 探测所有视频
    const infos = []
    for (const p of inputPaths) {
      try {
        infos.push(await probeVideo(p))
      } catch (err) {
        throw new Error(`"${p}" ${err.message}`)
      }
    }

    // 2. 统一输出规格：取最大分辨率、最高帧率
    const outW = Math.max(...infos.map((i) => i.width))
    const outH = Math.max(...infos.map((i) => i.height))
    const outFps = Math.max(...infos.map((i) => i.fps))
    const totalDuration = infos.reduce((s, i) => s + i.duration, 0)

    // 3. 构建输入参数：所有视频在前，无音轨视频的静音源按顺序追加在后
    const args = []
    const silentNeeded = [] // 无音轨视频在文件列表中的索引（按文件顺序）
    infos.forEach((info, i) => {
      args.push('-i', inputPaths[i])
      if (!info.hasAudio) {
        silentNeeded.push(i)
        const dur = info.duration || 0
        args.push(
          '-f',
          'lavfi',
          '-t',
          dur.toFixed(3),
          '-i',
          'anullsrc=channel_layout=stereo:sample_rate=48000'
        )
      }
    })

    // 4. 构建 filter_complex：统一视频规格 + 统一音频规格 + concat
    const fc = []
    const concatInputs = []
    infos.forEach((info, i) => {
      fc.push(
        `[${i}:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,` +
          `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,fps=${outFps},setsar=1[v${i}]`
      )

      // 音频流索引：有音轨用文件流，无音轨用追加的静音源流
      const audioIndex = info.hasAudio ? i : inputPaths.length + silentNeeded.indexOf(i)
      fc.push(
        `[${audioIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`
      )

      // concat 要求视频/音频流交替输入：v0 a0 v1 a1 ...
      concatInputs.push(`[v${i}]`, `[a${i}]`)
    })

    const n = infos.length
    fc.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=1[vout][aout]`)

    send(5, `正在合并 ${n} 个视频...`)

    await runFfmpeg(
      [
        ...args,
        '-filter_complex',
        fc.join(';'),
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '20',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-progress',
        'pipe:1',
        '-nostats',
        outputPath
      ],
      (t) => {
        const pct = totalDuration > 0 ? (t / totalDuration) * 100 : 0
        send(Math.min(99, Math.round(pct)), '正在合并...')
      }
    )

    send(100, '合并完成')
    event.sender.send('merge:done', { outputPath })
  } catch (err) {
    event.sender.send('merge:error', { message: String(err?.message || err) })
  } finally {
    processing = false
  }
}
