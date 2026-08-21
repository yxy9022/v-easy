import { existsSync } from 'fs'
import ffmpegStatic from 'ffmpeg-static'

/**
 * 解析 ffmpeg 可执行文件路径。
 * 优先级：
 *   1. 环境变量 FFMPEG_BIN（手动指定）
 *   2. 系统安装的 ffmpeg（Homebrew / /usr 目录），避免依赖网络下载的 ffmpeg-static 二进制
 *   3. ffmpeg-static 内置二进制（兜底）
 */
const systemCandidates = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg'
]

const systemFfmpeg = systemCandidates.find((p) => existsSync(p))
const bundledFfmpeg = ffmpegStatic && existsSync(ffmpegStatic) ? ffmpegStatic : null

export default process.env.FFMPEG_BIN || systemFfmpeg || bundledFfmpeg
