import { spawn } from 'child_process'
import { stat } from 'fs/promises'
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

/**
 * 主入口：压缩单个视频
 * - codec: 'h264' | 'h265'
 * - crf: 0~51，越小画质越好体积越大
 * - scaleHeight: 目标高度（像素），0 表示不缩放；宽度自动保持宽高比并取偶数
 * - preset: 'fast' | 'medium' | 'slow'
 * - keepAudio: 是否保留音轨
 * - duration: 视频总时长（秒），用于进度计算
 * - 完成时通过 compress:done 回传输出文件大小（字节）
 */
export async function compressVideo(
  event,
  { inputPath, outputPath, codec = 'h264', crf = 23, scaleHeight = 0, preset = 'fast', keepAudio = true, duration = 0 }
) {
  if (processing) throw new Error('已有压缩任务正在进行，请等待完成')
  if (!inputPath) throw new Error('未指定输入视频')
  if (!outputPath) throw new Error('未指定输出路径')

  processing = true
  const send = (percent, message) => {
    event.sender.send('compress:progress', { percent, message })
  }

  try {
    send(3, '正在准备压缩...')

    const args = ['-i', inputPath]

    // 缩放 + 保证输出像素格式为 yuv420p（兼容性最好）
    const vf = []
    if (scaleHeight && scaleHeight > 0) {
      vf.push(`scale=-2:${Math.round(scaleHeight)}`)
    }
    vf.push('format=yuv420p')
    args.push('-vf', vf.join(','))

    // 视频编码
    args.push(
      '-c:v',
      codec === 'h265' ? 'libx265' : 'libx264',
      '-preset',
      preset,
      '-crf',
      String(crf)
    )

    // 音频
    if (keepAudio) {
      args.push('-c:a', 'aac', '-b:a', '128k')
    } else {
      args.push('-an')
    }

    args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath)

    send(5, keepAudio ? '正在压缩（保留音轨）...' : '正在压缩（不含音轨）...')

    await runFfmpeg(args, (t) => {
      const pct = duration > 0 ? (t / duration) * 100 : 0
      send(Math.min(99, Math.round(pct)), '正在压缩...')
    })

    let outputSize = 0
    try {
      outputSize = (await stat(outputPath)).size
    } catch {
      outputSize = 0
    }

    send(100, '压缩完成')
    event.sender.send('compress:done', { outputPath, outputSize })
  } catch (err) {
    event.sender.send('compress:error', { message: String(err?.message || err) })
  } finally {
    processing = false
  }
}
