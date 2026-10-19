#!/usr/bin/env node
/**
 * 豆包视频「周期性交替水印」处理脚本
 *
 * 水印规律：每 N 秒在两个位置之间交替出现
 *   0-4s 右下角 → 4-8s 左上角 → 8-12s 右下角 → 12-16s 左上角 ...
 *
 * 用法：
 *   node scripts/doubao-wm.mjs preview <视频> [更多视频...]   # 画框预览，检查区域位置
 *   node scripts/doubao-wm.mjs run     <视频> [更多视频...]   # 执行去水印
 *
 * 示例：
 *   node scripts/doubao-wm.mjs preview ~/Downloads/a.mp4
 *   node scripts/doubao-wm.mjs run ~/Downloads/a.mp4 ~/Downloads/b.mp4
 *   node scripts/doubao-wm.mjs run ~/Downloads/*.mp4          # shell 展开，批量处理
 *
 * 输出：默认在「输入文件同目录」生成 原名_clean.mp4（不覆盖原文件）
 *       若设置了 CONFIG.outputDir，则统一输出到该目录
 *
 * 工作流：先 preview 看框准不准 → 调整 CONFIG 里的区域数值 → 再 run
 */

import { spawn } from 'child_process'
import { basename, dirname, extname, join } from 'path'
import ffmpegStatic from 'ffmpeg-static'

// ==================== 配置区（按实际效果调整）====================

const CONFIG = {
  // 统一输出目录；设为 null 则输出到「输入文件同目录」
  outputDir: null,

  // 水印区域按「分辨率」分别配置，key 为 '宽x高'
  // 脚本按输入视频分辨率自动匹配；处理新分辨率时，复制一份改数值即可
  presets: {
    // 4:3 横屏（已校准）
    '960x720': {
      topLeft: { x: 20, y: 12, w: 190, h: 70 },
      bottomRight: { x: 760, y: 640, w: 190, h: 70 }
    },

    // 9:16 竖屏（初始估值，请用 preview 校准）
    '720x1280': {
      topLeft: { x: 25, y: 25, w: 210, h: 70 },
      bottomRight: { x: 485, y: 1185, w: 210, h: 70 }
    }
  },

  // 未匹配到预设时，以此为基准等比缩放（仅为近似，建议补一条对应分辨率的预设）
  scaleBase: '960x720',

  // 交替周期（秒）：每 segment 秒换一次位置
  segment: 4,

  // 0 ~ segment 这个时间段，水印出现在哪（'bottomRight' 或 'topLeft'）
  firstPosition: 'bottomRight',

  // 预览时间点（秒）：建议分别看两个时刻，确认两个框都对准
  previewTimes: [2, 6]
}

// ==================== 以下为处理逻辑，一般无需修改 ====================

const { segment, firstPosition, outputDir } = CONFIG

/** 探测视频分辨率与时长 */
function probe(file) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, ['-i', file])
    let out = ''
    proc.stderr.on('data', (d) => (out += d.toString()))
    proc.on('close', () => {
      const dur = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      const res = out.match(/Video:.*?(\d{2,5})x(\d{2,5})/)
      if (!res) return reject(new Error('无法解析视频分辨率，请确认文件是有效视频'))
      resolve({
        duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + parseFloat(dur[3]) : 0,
        width: Number(res[1]),
        height: Number(res[2])
      })
    })
  })
}

/** 按给定倍率缩放区域坐标 */
function scaleRect(rect, rx, ry) {
  return {
    x: Math.round(rect.x * rx),
    y: Math.round(rect.y * ry),
    w: Math.round(rect.w * rx),
    h: Math.round(rect.h * ry)
  }
}

/**
 * 按视频分辨率取水印区域：
 *   - 命中 presets 中对应分辨率 → 直接用（准确）
 *   - 未命中 → 按 scaleBase 等比缩放（近似，建议补预设）
 */
function resolveRects(w, h) {
  const key = `${w}x${h}`
  const hit = CONFIG.presets[key]
  if (hit) return { rects: hit, source: `预设 ${key}` }

  const base = CONFIG.presets[CONFIG.scaleBase]
  if (!base) throw new Error(`缺少基准预设 ${CONFIG.scaleBase}`)
  const [bw, bh] = CONFIG.scaleBase.split('x').map(Number)
  return {
    rects: {
      topLeft: scaleRect(base.topLeft, w / bw, h / bh),
      bottomRight: scaleRect(base.bottomRight, w / bw, h / bh)
    },
    source: `按 ${CONFIG.scaleBase} 等比缩放（建议新增 ${key} 预设）`
  }
}

/** delogo 要求区域距边缘至少 1 像素，且不能越界 */
function clampForDelogo(r, w, h) {
  const cw = Math.min(Math.max(1, r.w), Math.max(1, w - 2))
  const ch = Math.min(Math.max(1, r.h), Math.max(1, h - 2))
  return {
    x: Math.min(Math.max(1, r.x), w - cw - 1),
    y: Math.min(Math.max(1, r.y), h - ch - 1),
    w: cw,
    h: ch
  }
}

/**
 * 生成各位置的时间段列表
 * 例如 segment=4, duration=15, firstPosition='bottomRight'
 *   bottomRight: [[0,4],[8,12]]
 *   topLeft:     [[4,8],[12,15]]
 */
function buildTimeRanges(duration) {
  const ranges = { topLeft: [], bottomRight: [] }
  const other = firstPosition === 'bottomRight' ? 'topLeft' : 'bottomRight'
  let index = 0
  for (let s = 0; s < duration; s += segment) {
    const e = Math.min(s + segment, duration)
    if (e - s < 0.05) break
    ranges[index % 2 === 0 ? firstPosition : other].push([s, e])
    index++
  }
  return ranges
}

/** 构建 delogo 滤镜链：每个「区域 × 时间段」展开为一个 delogo */
function buildFilters(rects, ranges, w, h) {
  const parts = []
  for (const [pos, rect] of Object.entries(rects)) {
    const list = ranges[pos] || []
    const r = clampForDelogo(rect, w, h)
    if (list.length === 0) {
      parts.push(`delogo=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}`)
      continue
    }
    for (const [s, e] of list) {
      parts.push(`delogo=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:enable='between(t,${s},${e})'`)
    }
  }
  return parts
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegStatic, args)
    let err = ''
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-800)))))
  })
}

/** 由输入路径推导输出路径：原名_clean.mp4 */
function outputPathFor(input) {
  const ext = extname(input)
  const name = basename(input, ext)
  return join(outputDir || dirname(input), `${name}_clean${ext || '.mp4'}`)
}

async function processFile(file, mode) {
  const meta = await probe(file)
  const { rects, source } = resolveRects(meta.width, meta.height)
  const ranges = buildTimeRanges(meta.duration)

  console.log(
    `\n▶ ${basename(file)}  (${meta.width}x${meta.height}, ${meta.duration.toFixed(2)}s)  坐标来源：${source}`
  )
  console.log(
    `  左上角 topLeft     ${JSON.stringify(rects.topLeft)} 时段 ${JSON.stringify(ranges.topLeft)}`
  )
  console.log(
    `  右下角 bottomRight ${JSON.stringify(rects.bottomRight)} 时段 ${JSON.stringify(ranges.bottomRight)}`
  )

  if (mode === 'preview') {
    const boxes = [
      `drawbox=x=${rects.topLeft.x}:y=${rects.topLeft.y}:w=${rects.topLeft.w}:h=${rects.topLeft.h}:color=green:t=3`,
      `drawbox=x=${rects.bottomRight.x}:y=${rects.bottomRight.y}:w=${rects.bottomRight.w}:h=${rects.bottomRight.h}:color=red:t=3`
    ].join(',')
    const name = basename(file, extname(file))
    for (const t of CONFIG.previewTimes) {
      const out = `/tmp/wm-${name}-${t}s.png`
      await runFfmpeg(['-ss', String(t), '-i', file, '-vf', boxes, '-frames:v', '1', '-y', out])
      console.log(`  预览图：${out}`)
    }
    return
  }

  const filters = buildFilters(rects, ranges, meta.width, meta.height)
  const output = outputPathFor(file)
  await runFfmpeg([
    '-i',
    file,
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
    '-y',
    output
  ])
  console.log(`  ✅ 已输出：${output}`)
}

async function main() {
  const [mode, ...files] = process.argv.slice(2)

  if (!mode || !files.length || !['preview', 'run'].includes(mode)) {
    console.log(`用法：
  node scripts/doubao-wm.mjs preview <视频> [更多视频...]   # 画框预览，检查区域位置
  node scripts/doubao-wm.mjs run     <视频> [更多视频...]   # 执行去水印

示例：
  node scripts/doubao-wm.mjs preview ~/Downloads/a.mp4
  node scripts/doubao-wm.mjs run ~/Downloads/*.mp4`)
    process.exit(1)
  }

  for (const file of files) {
    await processFile(file, mode)
  }

  if (mode === 'preview') {
    console.log('\n绿框 = 左上角区域，红框 = 右下角区域')
    console.log('确认框对准水印后，再执行 run；如需微调请修改脚本顶部 CONFIG')
  }
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
