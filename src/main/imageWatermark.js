import { spawn } from 'child_process'
import { extname } from 'path'
import ffmpegPath from './ffmpeg'

let processing = false

/**
 * 探测图片的原始像素尺寸。
 * 统一使用 -noautorotate 关闭 ffmpeg 的自动旋转，与渲染进程 image-orientation: none 的显示保持一致，
 * 保证界面上框选的坐标和 ffmpeg 实际处理的坐标是同一套。
 */
export function probeImage(inputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-noautorotate', '-i', inputPath])
    let out = ''
    proc.stderr.on('data', (buf) => (out += buf.toString()))
    proc.on('error', reject)
    proc.on('close', () => {
      const res = out.match(/Video:.*?(\d{2,5})x(\d{2,5})/)
      if (!res) return reject(new Error('无法解析图片尺寸，请确认是有效的图片文件'))
      resolve({ width: Number(res[1]), height: Number(res[2]) })
    })
  })
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args)
    let stderr = ''
    proc.stderr.on('data', (buf) => (stderr += buf.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else
        reject(new Error(stderr.split('\n').slice(-6).join('\n').trim() || `ffmpeg 退出码 ${code}`))
    })
  })
}

/**
 * 约束区域不越界。
 * inset 为距边缘的最小像素：delogo 要求区域四周至少留 1 像素，其余方式可为 0。
 */
function clampRegion(r, width, height, inset) {
  const maxW = Math.max(1, width - inset * 2)
  const maxH = Math.max(1, height - inset * 2)
  const w = Math.min(Math.max(1, Math.round(r.w)), maxW)
  const h = Math.min(Math.max(1, Math.round(r.h)), maxH)
  return {
    x: Math.min(Math.max(inset, Math.round(r.x)), width - w - inset),
    y: Math.min(Math.max(inset, Math.round(r.y)), height - h - inset),
    w,
    h
  }
}

/** 颜色归一化：#ffffff → 0xffffff（ffmpeg 滤镜不认 # 前缀） */
function normalizeColor(color) {
  const v = String(color || 'white').trim()
  return v.startsWith('#') ? `0x${v.slice(1)}` : v
}

/** 生成各处理方式的滤镜参数：返回 vf（单链）或 filterComplex（多输入链） */
function buildFilter({ regions, width, height, method, blurStrength, solidColor }) {
  if (method === 'delogo') {
    // 用周边像素插值填充被遮盖区域，背景简单时最自然
    const vf = regions
      .map((r) => {
        const c = clampRegion(r, width, height, 1)
        return `delogo=x=${c.x}:y=${c.y}:w=${c.w}:h=${c.h}`
      })
      .join(',')
    return { vf }
  }

  if (method === 'solid') {
    const color = normalizeColor(solidColor)
    const vf = regions
      .map((r) => {
        const c = clampRegion(r, width, height, 0)
        return `drawbox=x=${c.x}:y=${c.y}:w=${c.w}:h=${c.h}:color=${color}:t=fill`
      })
      .join(',')
    return { vf }
  }

  // blur：把水印区域连同周边一起裁剪后模糊，再取中心区域贴回原位置。
  // 带边距裁剪是为了让背景像素混进水印区，否则整块水印糊完还是一整块。
  // 注意：boxblur 半径上限为 15，超出会直接报错，这里做钳制。
  const strength = Math.min(15, Math.max(1, Math.round(Number(blurStrength) || 10)))
  const margin = Math.min(Math.max(strength * 2, 8), Math.floor(Math.min(width, height) / 2))

  const chains = []
  let base = '[0:v]'
  regions.forEach((r, i) => {
    const c = clampRegion(r, width, height, 0)
    const cx = Math.max(0, c.x - margin)
    const cy = Math.max(0, c.y - margin)
    const cw = Math.min(width - cx, c.w + margin * 2)
    const ch = Math.min(height - cy, c.h + margin * 2)
    const ix = c.x - cx
    const iy = c.y - cy
    const iw = Math.max(1, Math.min(c.w, cw - ix))
    const ih = Math.max(1, Math.min(c.h, ch - iy))

    chains.push(`[0:v]crop=${cw}:${ch}:${cx}:${cy},boxblur=${strength}:2[blur${i}]`)
    chains.push(`[blur${i}]crop=${iw}:${ih}:${ix}:${iy}[wm${i}]`)

    const isLast = i === regions.length - 1
    const out = isLast ? '' : `[base${i}]`
    chains.push(`${base}[wm${i}]overlay=${c.x}:${c.y}${out}`)
    if (!isLast) base = out
  })

  return { filterComplex: chains.join(';') }
}

/**
 * 主入口：去除图片指定区域的水印
 * - regions 为数组，每项是基于图片原始分辨率的矩形 { x, y, w, h }
 * - method：delogo（智能填充）/ blur（区域模糊）/ solid（纯色覆盖）
 * - 进度与结果通过 event.sender 回传渲染进程
 */
export async function removeImageWatermark(
  event,
  {
    inputPath,
    regions,
    imageWidth,
    imageHeight,
    method = 'delogo',
    blurStrength,
    solidColor,
    outputPath
  }
) {
  if (processing) throw new Error('已有图片去水印任务正在进行，请等待完成')

  if (!Array.isArray(regions) || regions.length === 0) {
    throw new Error('请至少框选一个水印区域')
  }

  const validRegions = regions.filter((r) => r && r.w > 0 && r.h > 0)
  if (validRegions.length === 0) {
    throw new Error('水印区域无效，请重新框选')
  }

  let width = Number(imageWidth)
  let height = Number(imageHeight)
  if (!width || !height) {
    const meta = await probeImage(inputPath)
    width = meta.width
    height = meta.height
  }

  processing = true
  const send = (percent, message) => {
    event.sender.send('image-watermark:progress', { percent, message })
  }

  try {
    send(10, '读取图片...')

    const { vf, filterComplex } = buildFilter({
      regions: validRegions,
      width,
      height,
      method,
      blurStrength,
      solidColor
    })

    const args = ['-noautorotate', '-i', inputPath]
    if (filterComplex) args.push('-filter_complex', filterComplex)
    else args.push('-vf', vf)

    // 只处理一帧：避免 GIF 等多帧输入时输出失败
    args.push('-frames:v', '1')

    // JPEG 有损编码，用较高画质档位
    const ext = extname(outputPath).toLowerCase()
    if (ext === '.jpg' || ext === '.jpeg') args.push('-q:v', '2')

    send(50, '正在去除水印...')
    args.push('-y', outputPath)

    await runFfmpeg(args)

    send(100, '去水印完成')
    event.sender.send('image-watermark:done', { outputPath })
  } catch (err) {
    event.sender.send('image-watermark:error', { message: String(err?.message || err) })
  } finally {
    processing = false
  }
}
