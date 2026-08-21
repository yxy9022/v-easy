import { spawn } from 'child_process'
import { join } from 'path'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
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

/** 探测视频基本信息（时长、是否有音轨），通过 ffmpeg -i 的 stderr 输出解析 */
function probeVideo(inputPath) {
  return new Promise((resolve, reject) => {
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
      const info = { duration: 0, hasAudio: false }

      const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (dur) info.duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
      if (stderr.includes('Audio:')) info.hasAudio = true

      if (!info.duration) {
        reject(
          new Error(
            (stderr.split('\n').slice(-8).join('\n').trim() || '无法解析视频时长') +
              '：文件可能已损坏或格式不受支持'
          )
        )
        return
      }
      resolve(info)
    })
  })
}

/**
 * 构造 atempo 滤镜链：单次 atempo 超过 2.0 会明显劣化音质，
 * 因此大于 2 的倍速拆成多个 atempo=2 与剩余系数的级联。
 * 例：8x -> atempo=2,atempo=2,atempo=2；3x -> atempo=2,atempo=1.5
 */
function atempoChain(speed) {
  const factors = []
  let remaining = speed
  while (remaining > 2.0001) {
    factors.push(2)
    remaining /= 2
  }
  if (remaining > 1.0001) factors.push(remaining)
  return factors.map((f) => `atempo=${f.toFixed(3)}`).join(',')
}

/**
 * 主入口：部分时间段加速
 * - clips: [{ start, end, speed }]，speed 为该段倍速（>1）
 * - 把整段视频按时间顺序切成「原速段 + 加速段」，逐段重编码，
 *   加速段视频用 setpts、音频用 atempo 提速，最后 concat demuxer 合并
 * - 进度通过 event.sender 回传渲染进程
 */
export async function speedVideo(event, { inputPath, clips, outputPath, keepAudio }) {
  if (processing) throw new Error('已有加速任务正在进行，请等待完成')
  const keepAudioFlag = keepAudio !== false // 默认保留声音

  const valid = (clips || [])
    .filter(
      (c) =>
        Number.isFinite(c.start) &&
        Number.isFinite(c.end) &&
        Number.isFinite(c.speed) &&
        c.speed > 1 &&
        c.end - c.start > 0.05
    )
    .sort((a, b) => a.start - b.start)
  if (!valid.length) throw new Error('请至少添加一个加速时间段')

  processing = true
  const send = (percent, message) => {
    event.sender.send('speed:progress', { percent, message })
  }

  let tmpDir
  try {
    send(2, '正在分析视频...')
    const info = await probeVideo(inputPath)
    if (!info.duration) throw new Error('无法获取视频时长')

    // 构建分段：正常段（speed=1）+ 加速段，按时间顺序且互不重叠
    const segments = []
    let cursor = 0
    for (const c of valid) {
      const start = Math.min(Math.max(c.start, 0), info.duration)
      const end = Math.min(Math.max(c.end, 0), info.duration)
      if (end <= start) continue
      if (start > cursor) segments.push({ start: cursor, end: start, speed: 1 })
      segments.push({ start, end, speed: c.speed })
      cursor = end
    }
    if (cursor < info.duration) segments.push({ start: cursor, end: info.duration, speed: 1 })

    // 输出总时长：加速段时长除以倍速
    const totalOut = segments.reduce((sum, seg) => sum + (seg.end - seg.start) / seg.speed, 0)

    tmpDir = await mkdtemp(join(tmpdir(), 'veasy-speed-'))
    const chunks = []
    let done = 0

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const dur = seg.end - seg.start
      const outDur = dur / seg.speed
      const chunkPath = join(tmpDir, `chunk_${i}.ts`)

      const args = ['-ss', String(seg.start), '-i', inputPath, '-t', String(dur)]
      if (seg.speed > 1.0001) {
        // PTS 归零后除以倍速，实现视频加速；音频用 atempo 链同步提速
        args.push('-filter:v', `setpts=(PTS-STARTPTS)/${seg.speed}`)
        if (keepAudioFlag && info.hasAudio) args.push('-filter:a', atempoChain(seg.speed))
      }
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '20',
        ...(keepAudioFlag && info.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
        '-pix_fmt',
        'yuv420p',
        '-start_at_zero',
        '-progress',
        'pipe:1',
        '-nostats',
        chunkPath
      )

      await runFfmpeg(args, (t) => {
        const pct = ((done + Math.min(t, outDur)) / totalOut) * 100
        send(Math.min(94, Math.round(pct)), `正在处理片段 ${i + 1}/${segments.length}`)
      })
      chunks.push(chunkPath)
      done += outDur
    }

    send(95, '正在合并片段...')
    if (chunks.length === 1) {
      await runFfmpeg(['-i', chunks[0], '-c', 'copy', '-movflags', '+faststart', outputPath])
    } else {
      const listPath = join(tmpDir, 'list.txt')
      await writeFile(listPath, chunks.map((p) => `file '${p}'`).join('\n'))
      await runFfmpeg([
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outputPath
      ])
    }

    send(100, '导出完成')
    event.sender.send('speed:done', { outputPath })
  } catch (err) {
    event.sender.send('speed:error', { message: String(err?.message || err) })
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    processing = false
  }
}
