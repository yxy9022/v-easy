import { spawn } from 'child_process'
import ffmpegPath from './ffmpeg'

let processing = false

/** 执行 ffmpeg，通过 stdout 的 -progress 输出回调节点进度（秒） */
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
        reject(new Error(stderr.split('\n').slice(-6).join('\n').trim() || `ffmpeg 退出码 ${code}`))
    })
  })
}

/**
 * 主入口：去除视频指定区域的水印
 * - regions 为数组，每个元素是相对视频原始分辨率的矩形 { x, y, w, h, startTime, endTime }
 * - 使用 delogo 滤镜（用周边像素插值填充矩形区域）并按时间范围启用，最后重编码输出
 * - 进度通过 event.sender 回传渲染进程
 */
export async function removeWatermark(
  event,
  { inputPath, regions, videoWidth, videoHeight, duration, outputPath }
) {
  if (processing) throw new Error('已有去水印任务正在进行，请等待完成')

  if (!Array.isArray(regions) || regions.length === 0) {
    throw new Error('请至少框选一个水印区域')
  }

  const validRegions = regions.filter((r) => r && r.w > 0 && r.h > 0)
  if (validRegions.length === 0) {
    throw new Error('水印区域无效，请重新框选')
  }

  processing = true
  const send = (percent, message) => {
    event.sender.send('watermark:progress', { percent, message })
  }

  try {
    send(5, '准备去水印...')

    // 构建 delogo filter：每个区域一个 delogo，并按时间范围 enable
    const filters = validRegions.map((r) => {
      const maxW = Math.max(1, videoWidth - 2)
      const maxH = Math.max(1, videoHeight - 2)
      const w = Math.min(Math.max(1, Math.round(r.w)), maxW)
      const h = Math.min(Math.max(1, Math.round(r.h)), maxH)
      const x = Math.min(Math.max(1, Math.round(r.x)), videoWidth - w - 1)
      const y = Math.min(Math.max(1, Math.round(r.y)), videoHeight - h - 1)

      const start = Number(r.startTime) || 0
      const end = Number(r.endTime)
      let filter = `delogo=x=${x}:y=${y}:w=${w}:h=${h}`
      if (Number.isFinite(end) && end > start) {
        // delogo 的 enable 表达式：只在指定时间范围内生效
        filter += `:enable='between(t,${start},${end})'`
      }
      return filter
    })

    await runFfmpeg(
      [
        '-i',
        inputPath,
        '-vf',
        filters.join(','),
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
        const pct = duration > 0 ? (t / duration) * 100 : 0
        send(Math.min(99, Math.round(pct)), '正在去除水印...')
      }
    )

    send(100, '去水印完成')
    event.sender.send('watermark:done', { outputPath })
  } catch (err) {
    event.sender.send('watermark:error', { message: String(err?.message || err) })
  } finally {
    processing = false
  }
}
