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

/** 视频编码器 key -> ffmpeg 编码器名 */
const VCODEC_MAP = {
  h264: 'libx264',
  h265: 'libx265',
  vp8: 'libvpx',
  vp9: 'libvpx-vp9',
  av1: 'libsvtav1',
  mpeg4: 'mpeg4'
}

/** 音频编码器 key -> ffmpeg 编码器名 */
const ACODEC_MAP = {
  aac: 'aac',
  mp3: 'libmp3lame',
  opus: 'libopus',
  vorbis: 'libvorbis',
  flac: 'flac',
  pcm: 'pcm_s16le'
}

/** 纯音频格式（无视频流） */
const AUDIO_FORMATS = ['mp3', 'flac', 'wav']

/**
 * 质量（0~100，越大画质越好）映射为各编码器参数
 * - libx264/libx265: crf 18~51（值越小画质越好）
 * - vp9/av1: crf 31~63
 * - mpeg4: qscale 2~31
 */
function qualityArgs(vcodec, quality) {
  const q = Math.max(0, Math.min(100, quality ?? 80))
  if (vcodec === 'h264' || vcodec === 'h265') {
    return ['-crf', String(51 - Math.round((q / 100) * 33))]
  }
  if (vcodec === 'vp8' || vcodec === 'vp9' || vcodec === 'av1') {
    return ['-crf', String(63 - Math.round((q / 100) * 32))]
  }
  if (vcodec === 'mpeg4') {
    return ['-qscale:v', String(31 - Math.round((q / 100) * 29))]
  }
  return []
}

/**
 * 主入口：转码单个视频/提取音频
 * - format: 'mp4' | 'mkv' | 'mov' | 'avi' | 'webm' | 'gif' | 'mp3' | 'flac' | 'wav'
 * - vcodec: 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1' | 'mpeg4'（音频格式忽略）
 * - acodec: 'aac' | 'mp3' | 'opus' | 'vorbis' | 'flac' | 'pcm'
 * - quality: 0~100 质量（音频格式忽略）
 * - scaleHeight: 目标高度（像素），0 表示不缩放（GIF 默认 480）
 * - fps: 目标帧率，0 表示保持原始
 * - keepAudio: 是否保留音轨（gif 忽略）
 * - duration: 总时长（秒），用于进度计算
 * - 完成时通过 convert:done 回传输出文件大小（字节）
 */
export async function convertVideo(
  event,
  {
    inputPath,
    outputPath,
    format = 'mp4',
    vcodec = 'h264',
    acodec = 'aac',
    quality = 80,
    scaleHeight = 0,
    fps = 0,
    keepAudio = true,
    duration = 0
  }
) {
  if (processing) throw new Error('已有转码任务正在进行，请等待完成')
  if (!inputPath) throw new Error('未指定输入视频')
  if (!outputPath) throw new Error('未指定输出路径')

  processing = true
  const send = (percent, message) => {
    event.sender.send('convert:progress', { percent, message })
  }

  try {
    send(3, '正在准备转码...')

    const isAudio = AUDIO_FORMATS.includes(format)
    const isGif = format === 'gif'
    const args = ['-i', inputPath]

    if (isGif) {
      // GIF 动图：固定 15fps，默认缩放到 480 高，2 比特率保真
      const vf = ['fps=15']
      const h = scaleHeight > 0 ? scaleHeight : 480
      vf.push(`scale=-2:${h}`)
      vf.push('split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse')
      args.push('-vf', vf.join(','), '-c:v', 'gif', '-loop', '0')
    } else if (isAudio) {
      // 纯音频格式：去掉视频流
      args.push('-vn')
    } else {
      // 视频格式：缩放 + 帧率 + yuv420p
      const vf = []
      if (scaleHeight && scaleHeight > 0) vf.push(`scale=-2:${Math.round(scaleHeight)}`)
      if (fps && fps > 0) vf.push(`fps=${Math.round(fps)}`)
      vf.push('format=yuv420p')
      args.push('-vf', vf.join(','))
      args.push('-c:v', VCODEC_MAP[vcodec] || 'libx264')
      args.push(...qualityArgs(vcodec, quality))
      if (vcodec === 'h265') args.push('-tag:v', 'hvc1')
    }

    // 音频
    if (isGif) {
      // GIF 无音轨
    } else if (keepAudio || isAudio) {
      args.push('-c:a', ACODEC_MAP[acodec] || 'aac')
      if (acodec === 'mp3') args.push('-b:a', '192k')
      if (acodec === 'opus') args.push('-b:a', '128k')
    } else {
      args.push('-an')
    }

    // faststart 仅对 mp4/mov 生效，避免其它容器告警
    if (format === 'mp4' || format === 'mov') args.push('-movflags', '+faststart')

    args.push('-progress', 'pipe:1', '-nostats', outputPath)

    send(
      5,
      isGif
        ? '正在生成 GIF 动图...'
        : isAudio
          ? `正在提取${format.toUpperCase()}音频...`
          : `正在转码为 ${format.toUpperCase()}...`
    )

    await runFfmpeg(args, (t) => {
      const pct = duration > 0 ? (t / duration) * 100 : 0
      send(Math.min(99, Math.round(pct)), '正在转码...')
    })

    let outputSize = 0
    try {
      outputSize = (await stat(outputPath)).size
    } catch {
      outputSize = 0
    }

    send(100, '转码完成')
    event.sender.send('convert:done', { outputPath, outputSize })
  } catch (err) {
    event.sender.send('convert:error', { message: String(err?.message || err) })
  } finally {
    processing = false
  }
}
