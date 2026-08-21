<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import UploadZone from '../components/UploadZone.vue'
import { message, dialog } from '../utils/naive'

const videoFile = ref(null)
const videoUrl = ref('')
const videoEl = ref(null)

const duration = ref(0)
const videoWidth = ref(0)
const videoHeight = ref(0)
const sourceSize = ref(0)
const outputSize = ref(0)

const isConverting = ref(false)
const convertStatus = ref('idle') // idle | running | done | error
const convertProgress = ref(0)
const convertMessage = ref('')
const outputDir = ref('')

// ---------- 转码设置 ----------
const format = ref('mp4')
const vcodec = ref('h264')
const acodec = ref('aac')
const quality = ref(80)
const resolution = ref('original') // original | 1080 | 720 | 480
const fps = ref(0) // 0=原始 | 24 | 30 | 60
const keepAudio = ref(true)

// 目标格式卡片
const formats = [
  { key: 'mp4', label: 'MP4', desc: '通用格式 · H.264', hint: '兼容性最好，推荐' },
  { key: 'mkv', label: 'MKV', desc: '全能容器', hint: '支持多种编码/多音轨' },
  { key: 'mov', label: 'MOV', desc: 'Apple 生态', hint: 'Mac/iPhone 友好' },
  { key: 'avi', label: 'AVI', desc: '老式设备', hint: '兼容老旧播放器' },
  { key: 'webm', label: 'WebM', desc: '网页播放 · VP9', hint: '体积小，浏览器直开' },
  { key: 'gif', label: 'GIF', desc: '动画图片', hint: '15fps 动图' },
  { key: 'mp3', label: 'MP3', desc: '提取音频', hint: '常见音乐格式' },
  { key: 'flac', label: 'FLAC', desc: '无损音频', hint: '体积大，音质无损' },
  { key: 'wav', label: 'WAV', desc: '无损音频', hint: '未压缩，音质最好' }
]

// 各格式可选的视频编码器
const vcodecMap = {
  mp4: [
    { value: 'h264', label: 'H.264' },
    { value: 'h265', label: 'H.265' },
    { value: 'mpeg4', label: 'MPEG-4' }
  ],
  mkv: [
    { value: 'h264', label: 'H.264' },
    { value: 'h265', label: 'H.265' },
    { value: 'vp9', label: 'VP9' },
    { value: 'av1', label: 'AV1' }
  ],
  mov: [
    { value: 'h264', label: 'H.264' },
    { value: 'h265', label: 'H.265' }
  ],
  avi: [
    { value: 'mpeg4', label: 'MPEG-4' },
    { value: 'h264', label: 'H.264' }
  ],
  webm: [
    { value: 'vp9', label: 'VP9' },
    { value: 'vp8', label: 'VP8' },
    { value: 'av1', label: 'AV1' }
  ]
}

// 各格式可选的音频编码器
const acodecMap = {
  mp4: [
    { value: 'aac', label: 'AAC' },
    { value: 'mp3', label: 'MP3' }
  ],
  mov: [
    { value: 'aac', label: 'AAC' },
    { value: 'mp3', label: 'MP3' }
  ],
  mkv: [
    { value: 'aac', label: 'AAC' },
    { value: 'mp3', label: 'MP3' },
    { value: 'flac', label: 'FLAC' },
    { value: 'opus', label: 'Opus' }
  ],
  avi: [
    { value: 'mp3', label: 'MP3' },
    { value: 'aac', label: 'AAC' }
  ],
  webm: [
    { value: 'opus', label: 'Opus' },
    { value: 'vorbis', label: 'Vorbis' }
  ],
  mp3: [{ value: 'mp3', label: 'MP3' }],
  flac: [{ value: 'flac', label: 'FLAC' }],
  wav: [{ value: 'pcm', label: 'PCM' }]
}

// 各格式默认编码（gif 无音轨，a 用于兜底）
const defaultCodec = {
  mp4: { v: 'h264', a: 'aac' },
  mkv: { v: 'h264', a: 'aac' },
  mov: { v: 'h264', a: 'aac' },
  avi: { v: 'mpeg4', a: 'mp3' },
  webm: { v: 'vp9', a: 'opus' },
  gif: { v: null, a: 'aac' },
  mp3: { v: null, a: 'mp3' },
  flac: { v: null, a: 'flac' },
  wav: { v: null, a: 'pcm' }
}

const isAudioFormat = computed(() => ['mp3', 'flac', 'wav'].includes(format.value))
const isGifFormat = computed(() => format.value === 'gif')
const isVideoFormat = computed(() => !isAudioFormat.value && !isGifFormat.value)

const vcodecOptions = computed(() => vcodecMap[format.value] || [])
const acodecOptions = computed(() => acodecMap[format.value] || [])

/** 切换格式：重置编码器为默认值 */
function selectFormat(key) {
  format.value = key
  const def = defaultCodec[key] || {}
  if (def.v) vcodec.value = def.v
  if (def.a) acodec.value = def.a
}

const resolutionOptions = [
  { label: '原始', value: 'original' },
  { label: '1080p', value: '1080' },
  { label: '720p', value: '720' },
  { label: '480p', value: '480' }
]

const fpsOptions = [
  { label: '原始', value: 0 },
  { label: '24', value: 24 },
  { label: '30', value: 30 },
  { label: '60', value: 60 }
]

const scaleHeight = computed(() => {
  if (resolution.value === 'original') return 0
  return Number(resolution.value)
})

const qualityTip = computed(() => {
  const q = quality.value
  if (q >= 85) return '高画质，体积相对较大'
  if (q >= 60) return '画质与体积均衡（推荐）'
  if (q >= 35) return '画质有损，体积明显减小'
  return '画质较差，体积最小'
})

const formatDesc = computed(() => formats.find((f) => f.key === format.value)?.hint || '')

// ---------- 视频信息 ----------
function formatSize(size) {
  if (size >= 1024 * 1024 * 1024) return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + ' MB'
  return (size / 1024).toFixed(2) + ' KB'
}

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
    : [m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

const fileSizeText = computed(() => (sourceSize.value ? formatSize(sourceSize.value) : ''))
const durationText = computed(() => formatTime(duration.value))
const resolutionText = computed(() =>
  videoWidth.value && videoHeight.value ? `${videoWidth.value}x${videoHeight.value}` : ''
)

/** 转码结果对比文案 */
const resultText = computed(() => {
  if (convertStatus.value !== 'done' || !outputSize.value) return ''
  const before = formatSize(sourceSize.value)
  const after = formatSize(outputSize.value)
  let ratio = ''
  if (sourceSize.value > 0) {
    const pct = (1 - outputSize.value / sourceSize.value) * 100
    ratio = pct >= 0 ? `，体积减少 ${pct.toFixed(1)}%` : `，体积增加 ${(-pct).toFixed(1)}%`
  }
  return `转码前 ${before} → 转码后 ${after}${ratio}`
})

function handleFile(file) {
  if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
    message.warning('请选择视频或音频文件')
    return
  }
  videoFile.value = file
  sourceSize.value = file.size
  videoUrl.value = URL.createObjectURL(file)
}

function resetVideo() {
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
  videoUrl.value = ''
  videoFile.value = null
  duration.value = 0
  videoWidth.value = 0
  videoHeight.value = 0
  sourceSize.value = 0
  outputSize.value = 0
  convertStatus.value = 'idle'
  convertProgress.value = 0
  convertMessage.value = ''
}

function onLoadedMetadata() {
  duration.value = videoEl.value?.duration || 0
  videoWidth.value = videoEl.value?.videoWidth || 0
  videoHeight.value = videoEl.value?.videoHeight || 0
}

/** 重新选择文件前弹出确认框 */
function confirmResetVideo() {
  dialog.warning({
    title: '重新选择文件',
    content: '确定重新选择文件吗？当前转码设置将保留。',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: resetVideo
  })
}

// ---------- 转码导出 ----------
let offProgress = null
let offDone = null
let offError = null

onMounted(() => {
  window.api?.getDesktopPath?.().then((p) => {
    if (p) outputDir.value = p
  })

  offProgress = window.api?.onConvertProgress((data) => {
    convertProgress.value = data.percent
    convertMessage.value = data.message
  })
  offDone = window.api?.onConvertDone((data) => {
    isConverting.value = false
    convertStatus.value = 'done'
    outputSize.value = data.outputSize || 0
    convertMessage.value = `已导出：${data.outputPath}`
  })
  offError = window.api?.onConvertError((data) => {
    isConverting.value = false
    convertStatus.value = 'error'
    convertMessage.value = `转码失败：${data.message}`
  })
})

onUnmounted(() => {
  offProgress?.()
  offDone?.()
  offError?.()
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
})

const canConvert = computed(() => !!videoFile.value && !isConverting.value && !!outputDir.value)

const progressColor = computed(() => {
  if (convertStatus.value === 'error') return '#dc2626'
  if (convertStatus.value === 'done') return '#22c55e'
  return '#2563eb'
})

async function selectOutputDir() {
  if (!window.api?.selectDirectory) {
    message.warning('选择目录功能不可用，请重启应用后重试')
    return
  }
  const res = await window.api.selectDirectory()
  if (res && !res.canceled && res.dirPath) {
    outputDir.value = res.dirPath
  }
}

async function applyConvert() {
  if (!videoFile.value) {
    message.warning('请先选择文件')
    return
  }
  if (!outputDir.value) {
    message.warning('请先选择保存目录')
    return
  }

  const inputPath = window.api?.getPathForFile(videoFile.value)
  if (!inputPath) {
    convertStatus.value = 'error'
    convertMessage.value = '无法获取文件路径'
    return
  }

  convertStatus.value = 'running'
  convertProgress.value = 0
  convertMessage.value = '准备转码...'
  isConverting.value = true

  const res = await window.api?.convertVideo({
    inputPath,
    outputDir: outputDir.value,
    format: format.value,
    vcodec: isVideoFormat.value ? vcodec.value : null,
    acodec: acodec.value,
    quality: quality.value,
    scaleHeight: scaleHeight.value,
    fps: fps.value,
    keepAudio: keepAudio.value,
    duration: duration.value
  })

  if (res && res.canceled) {
    isConverting.value = false
    convertStatus.value = 'idle'
    convertMessage.value = ''
  }
}

// 切换格式时，若该格式不支持当前编码器则回退默认
watch(format, () => {
  const def = defaultCodec[format.value] || {}
  if (def.v && !vcodecOptions.value.find((o) => o.value === vcodec.value)) vcodec.value = def.v
  if (!acodecOptions.value.find((o) => o.value === acodec.value)) acodec.value = def.a
})
</script>

<template>
  <div class="page">
    <!-- 未选择文件：上传区 -->
    <div v-if="!videoFile" class="upload-wrap">
      <UploadZone
        button-text="选择文件"
        :tips="[
          '点击或拖拽视频/音频到此',
          '支持转码为 MP4/MKV/MOV/AVI/WebM/GIF，或提取 MP3/FLAC/WAV 音频'
        ]"
        accept="video/*,audio/*"
        @select="handleFile"
      />
    </div>

    <!-- 已选择文件 -->
    <div v-else class="convert-view">
      <div class="split">
        <!-- 左列：预览 -->
        <div class="split-left">
          <div class="preview-wrap">
            <video
              v-if="videoFile.type.startsWith('video/')"
              ref="videoEl"
              :src="videoUrl"
              controls
              class="preview-video"
              @loadedmetadata="onLoadedMetadata"
            ></video>
            <div v-else class="audio-preview">
              <svg
                class="audio-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"
                />
              </svg>
              <span class="audio-preview-name" :title="videoFile.name">{{ videoFile.name }}</span>
            </div>
          </div>
        </div>

        <!-- 右栏：转码设置 -->
        <div class="split-right">
          <div class="convert-panel right-panel">
            <!-- 文件信息 -->
            <div class="info-block">
              <div class="file-name-row">
                <div class="file-name" :title="videoFile.name">{{ videoFile.name }}</div>
                <button
                  type="button"
                  class="reset-btn"
                  :disabled="isConverting"
                  @click="confirmResetVideo"
                >
                  更换
                </button>
              </div>
              <div class="info-rows">
                <div class="info-row">
                  <span class="info-label">文件大小</span>
                  <span class="info-value">{{ fileSizeText }}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">时长 / 分辨率</span>
                  <span class="info-value">{{ durationText }} · {{ resolutionText }}</span>
                </div>
              </div>
            </div>

            <!-- 目标格式 -->
            <div class="setting-block">
              <div class="setting-title">目标格式</div>
              <div class="format-grid">
                <button
                  v-for="f in formats"
                  :key="f.key"
                  type="button"
                  class="format-btn"
                  :class="{ active: format === f.key }"
                  :title="f.hint"
                  @click="selectFormat(f.key)"
                >
                  <span class="format-label">{{ f.label }}</span>
                  <span class="format-desc">{{ f.desc }}</span>
                </button>
              </div>
              <p class="setting-tip">{{ formatDesc }}</p>
            </div>

            <!-- 视频编码器（视频格式） -->
            <div v-if="isVideoFormat" class="setting-block">
              <div class="setting-title">视频编码器</div>
              <div class="opt-group">
                <button
                  v-for="opt in vcodecOptions"
                  :key="opt.value"
                  type="button"
                  class="opt-btn"
                  :class="{ active: vcodec === opt.value }"
                  @click="vcodec = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 画质（视频格式，非 GIF） -->
            <div v-if="isVideoFormat" class="setting-block">
              <div class="setting-title-row">
                <span class="setting-title">画质</span>
                <span class="setting-value">{{ quality }}</span>
              </div>
              <n-slider v-model:value="quality" :min="10" :max="100" :step="1" :tooltip="false" />
              <p class="setting-tip">{{ qualityTip }}</p>
            </div>

            <!-- 分辨率（视频格式） -->
            <div v-if="isVideoFormat" class="setting-block">
              <div class="setting-title">分辨率</div>
              <div class="opt-group">
                <button
                  v-for="opt in resolutionOptions"
                  :key="opt.value"
                  type="button"
                  class="opt-btn"
                  :class="{ active: resolution === opt.value }"
                  @click="resolution = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 帧率（视频格式，非 GIF） -->
            <div v-if="isVideoFormat && !isGifFormat" class="setting-block">
              <div class="setting-title">帧率</div>
              <div class="opt-group">
                <button
                  v-for="opt in fpsOptions"
                  :key="opt.value"
                  type="button"
                  class="opt-btn"
                  :class="{ active: fps === opt.value }"
                  @click="fps = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 音频编码器 -->
            <div class="setting-block">
              <div class="setting-title">音频编码器</div>
              <div class="opt-group">
                <button
                  v-for="opt in acodecOptions"
                  :key="opt.value"
                  type="button"
                  class="opt-btn"
                  :class="{ active: acodec === opt.value }"
                  @click="acodec = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 保留音轨（视频格式，非 GIF） -->
            <div v-if="isVideoFormat && !isGifFormat" class="setting-block row">
              <span class="setting-title">保留音轨</span>
              <n-switch v-model:value="keepAudio" size="small" />
            </div>

            <!-- 保存目录 -->
            <div class="output-dir">
              <span class="output-dir-label">保存至：</span>
              <input
                class="output-dir-input"
                :value="outputDir"
                placeholder="请选择保存目录"
                readonly
              />
              <n-button
                class="output-dir-btn"
                quaternary
                circle
                :disabled="isConverting"
                @click="selectOutputDir"
              >
                <template #icon>
                  <svg
                    class="output-dir-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                    />
                  </svg>
                </template>
              </n-button>
            </div>

            <div class="apply-bar">
              <n-button
                type="primary"
                size="large"
                block
                :disabled="!canConvert"
                @click="applyConvert"
              >
                {{ isConverting ? '转码中...' : '开始转码' }}
              </n-button>
            </div>

            <!-- 进度 / 结果 -->
            <div
              v-if="convertStatus !== 'idle'"
              class="convert-progress"
              :class="'convert-' + convertStatus"
            >
              <n-progress
                type="line"
                :percentage="convertProgress"
                :height="8"
                :show-indicator="false"
                :color="progressColor"
                rail-color="#e2e8f0"
              />
              <p class="progress-message">{{ convertMessage }}</p>
              <p v-if="resultText" class="result-text">{{ resultText }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  margin: 0 -28px;
}

.upload-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

/* ---------- 转码视图 ---------- */
.convert-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.split {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  position: relative;
}

.split-left {
  flex: 1;
  min-width: 0;
  margin-right: 320px;
  margin-bottom: -24px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.split-right {
  position: absolute;
  top: -24px;
  right: 0;
  bottom: -24px;
  width: 320px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ---------- 预览区 ---------- */
.preview-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #000000;
  overflow: hidden;
}

.preview-video {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
}

.audio-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: #64748b;
}

.audio-icon {
  width: 72px;
  height: 72px;
  opacity: 0.7;
}

.audio-preview-name {
  max-width: 420px;
  font-size: 13px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- 右栏设置面板 ---------- */
.convert-panel {
  flex: 1;
  min-height: 0;
  padding: 20px;
  overflow-y: auto;
  border: none;
  border-radius: 0;
  background-color: #ffffff;
}

/* 文件信息 */
.info-block {
  padding: 12px 14px;
  border-radius: 10px;
  background-color: #f8fafc;
  border: 1px solid #eef2f7;
}

.file-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.file-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reset-btn {
  flex-shrink: 0;
  padding: 2px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background-color: #ffffff;
  color: #475569;
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s;
}

.reset-btn:hover:not(:disabled) {
  border-color: #2563eb;
  color: #2563eb;
}

.reset-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.info-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.info-label {
  color: #64748b;
}

.info-value {
  font-weight: 600;
  color: #334155;
}

/* 设置块 */
.setting-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 18px;
}

.setting-block.row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.setting-title {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.setting-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.setting-value {
  font-size: 13px;
  font-weight: 700;
  color: #2563eb;
  min-width: 24px;
  text-align: right;
}

.setting-tip {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
}

/* 格式卡片 */
.format-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.format-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background-color: #ffffff;
  color: #475569;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s,
    color 0.15s;
}

.format-btn:hover {
  border-color: #93c5fd;
  color: #2563eb;
}

.format-btn.active {
  border-color: #2563eb;
  background-color: #eff6ff;
  color: #2563eb;
}

.format-label {
  font-size: 13px;
  font-weight: 700;
}

.format-desc {
  font-size: 10px;
  color: #94a3b8;
}

.format-btn.active .format-desc {
  color: #60a5fa;
}

/* 选项按钮组（替代 radio-group，规避 naive-ui splitor key 冲突） */
.opt-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.opt-btn {
  padding: 5px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background-color: #ffffff;
  color: #475569;
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s,
    color 0.15s;
}

.opt-btn:hover {
  border-color: #93c5fd;
  color: #2563eb;
}

.opt-btn.active {
  border-color: #2563eb;
  background-color: #eff6ff;
  color: #2563eb;
  font-weight: 600;
}

/* 保存目录 */
.output-dir {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
}

.output-dir-label {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.output-dir-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background-color: #f8fafc;
  color: #334155;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.output-dir-input::placeholder {
  color: #94a3b8;
}

.output-dir-icon {
  width: 16px;
  height: 16px;
}

.apply-bar {
  margin-top: 16px;
}

.convert-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 8px;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
}

.progress-message {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  word-break: break-all;
}

.result-text {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #16a34a;
}

.convert-error .progress-message {
  color: #dc2626;
}
</style>
