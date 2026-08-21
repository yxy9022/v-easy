import { spawn } from 'child_process'
import { join } from 'path'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import ffmpegPath from './ffmpeg'

let processing = false

/**
 * 计算实际需要裁剪的片段列表
 * - keep：保留所选片段，直接使用片段列表
 * - remove：删除所选片段，取补集（未选中的区间）
 */
function computeSegments(mode, clips, duration) {
  // 过滤无效片段：时长过短或 start >= end
  const sorted = [...clips]
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end - c.start > 0.05)
    .sort((a, b) => a.start - b.start)
  if (mode !== 'remove') return sorted
  const result = []
  let cursor = 0
  for (const clip of sorted) {
    if (clip.start > cursor) result.push({ start: cursor, end: clip.start })
    cursor = Math.max(cursor, clip.end)
  }
  if (cursor < duration) result.push({ start: cursor, end: duration })
  return result.filter((seg) => seg.end - seg.start > 0.05)
}

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
 * 主入口：按片段裁剪并合并为单个视频
 * - 逐段 -ss/-t + -c copy 快速无损截取（精度为关键帧对齐）
 * - 多段时通过 concat demuxer 合并
 * - 进度通过 event.sender 回传渲染进程
 */
export async function cropVideo(event, { inputPath, mode, clips, duration, outputPath }) {
  if (processing) throw new Error('已有裁剪任务正在进行，请等待完成')

  const segments = computeSegments(mode, clips, duration)
  if (!segments.length) throw new Error('没有可导出的片段')

  processing = true
  const send = (percent, message) => {
    event.sender.send('crop:progress', { percent, message })
  }

  let tmpDir
  try {
    tmpDir = await mkdtemp(join(tmpdir(), 'veasy-crop-'))
    const chunks = []
    const total = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
    let done = 0

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const dur = seg.end - seg.start
      const chunkPath = join(tmpDir, `chunk_${i}.ts`)
      // 用重编码保证每个片段的时长精确（-ss/-t 精确生效，PTS 从 0 开始），
      // 避免 -c copy 时关键帧对齐 + 时间戳不归零导致 concat 后总时长被拉长
      await runFfmpeg(
        [
          '-ss',
          String(seg.start),
          '-i',
          inputPath,
          '-t',
          String(dur),
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
          '-start_at_zero',
          '-progress',
          'pipe:1',
          '-nostats',
          chunkPath
        ],
        (t) => {
          const pct = ((done + Math.min(t, dur)) / total) * 100
          send(Math.min(94, Math.round(pct)), `正在裁剪片段 ${i + 1}/${segments.length}`)
        }
      )
      chunks.push(chunkPath)
      done += dur
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
    event.sender.send('crop:done', { outputPath })
  } catch (err) {
    event.sender.send('crop:error', { message: String(err?.message || err) })
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    processing = false
  }
}
