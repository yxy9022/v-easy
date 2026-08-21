<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
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

const isCompressing = ref(false)
const compressStatus = ref('idle') // idle | running | done | error
const compressProgress = ref(0)
const compressMessage = ref('')
const outputDir = ref('')

// ---------- 压缩设置 ----------
const preset = ref('balanced') // high | balanced | small | custom
const crf = ref(23)
const resolution = ref('original') // original | 1080 | 720 | 480
const codec = ref('h264')
const speed = ref('fast') // fast | medium | slow
const keepAudio = ref(true)

// 快捷档位：点击即设置 CRF 与分辨率
const qualityPresets = [
  { key: 'high', label: '高质量', crf: 18, res: 'original', tip: '画质接近原片，体积略小' },
  { key: 'balanced', label: '均衡', crf: 23, res: 'original', tip: '画质与体积平衡（推荐）' },
  { key: 'small', label: '小体积', crf: 28, res: '1080', tip: '明显缩小体积，画质有损' }
]

const resolutionOptions = [
  { label: '原始', value: 'original' },
  { label: '1080p', value: '1080' },
  { label: '720p', value: '720' },
  { label: '480p', value: '480' }
]

const codecOptions = [
  { label: 'H.264', value: 'h264', tip: '兼容性最好' },
  { label: 'H.265', value: 'h265', tip: '压缩率更高，编码更慢' }
]

const speedOptions = [
  { label: '快速', value: 'fast' },
  { label: '标准', value: 'medium' },
  { label: '高质量', value: 'slow' }
]

function applyPreset(p) {
  preset.value = p.key
  crf.value = p.crf
  resolution.value = p.res
}

/** 用户手动修改参数后，档位切到"自定义" */
function markCustom() {
  preset.value = 'custom'
}

function onCrfChange(v) {
  crf.value = v
  markCustom()
}

function onResolutionChange(v) {
  resolution.value = v
  markCustom()
}

/** 目标高度：0 表示不缩放 */
const scaleHeight = computed(() => {
  if (resolution.value === 'original') return 0
  return Number(resolution.value)
})

const crfTip = computed(() => {
  const v = crf.value
  if (v <= 19) return '画质接近原片，压缩率较低'
  if (v <= 24) return '画质与体积较为均衡'
  if (v <= 28) return '画质有轻微损失，体积明显减小'
  return '画质损失明显，体积最小'
})

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

/** 压缩结果对比文案 */
const resultText = computed(() => {
  if (compressStatus.value !== 'done' || !outputSize.value) return ''
  const before = formatSize(sourceSize.value)
  const after = formatSize(outputSize.value)
  let ratio = ''
  if (sourceSize.value > 0) {
    const pct = (1 - outputSize.value / sourceSize.value) * 100
    ratio = pct >= 0 ? `，体积减少 ${pct.toFixed(1)}%` : `，体积增加 ${(-pct).toFixed(1)}%`
  }
  return `压缩前 ${before} → 压缩后 ${after}${ratio}`
})

function handleFile(file) {
  if (!file.type.startsWith('video/')) {
    message.warning('请选择视频文件')
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
  compressStatus.value = 'idle'
  compressProgress.value = 0
  compressMessage.value = ''
}

function onLoadedMetadata() {
  duration.value = videoEl.value?.duration || 0
  videoWidth.value = videoEl.value?.videoWidth || 0
  videoHeight.value = videoEl.value?.videoHeight || 0
}

/** 重新选择视频前弹出确认框 */
function confirmResetVideo() {
  dialog.warning({
    title: '重新选择视频',
    content: '确定重新选择视频吗？当前压缩设置将保留。',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: resetVideo
  })
}

// ---------- 压缩导出 ----------
let offProgress = null
let offDone = null
let offError = null

onMounted(() => {
  window.api?.getDesktopPath?.().then((p) => {
    if (p) outputDir.value = p
  })

  offProgress = window.api?.onCompressProgress((data) => {
    compressProgress.value = data.percent
    compressMessage.value = data.message
  })
  offDone = window.api?.onCompressDone((data) => {
    isCompressing.value = false
    compressStatus.value = 'done'
    outputSize.value = data.outputSize || 0
    compressMessage.value = `已导出：${data.outputPath}`
  })
  offError = window.api?.onCompressError((data) => {
    isCompressing.value = false
    compressStatus.value = 'error'
    compressMessage.value = `压缩失败：${data.message}`
  })
})

onUnmounted(() => {
  offProgress?.()
  offDone?.()
  offError?.()
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
})

const canCompress = computed(() => !!videoFile.value && !isCompressing.value && !!outputDir.value)

const progressColor = computed(() => {
  if (compressStatus.value === 'error') return '#dc2626'
  if (compressStatus.value === 'done') return '#22c55e'
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

async function applyCompress() {
  if (!videoFile.value) {
    message.warning('请先选择视频')
    return
  }
  if (!outputDir.value) {
    message.warning('请先选择保存目录')
    return
  }

  const inputPath = window.api?.getPathForFile(videoFile.value)
  if (!inputPath) {
    compressStatus.value = 'error'
    compressMessage.value = '无法获取视频文件路径'
    return
  }

  compressStatus.value = 'running'
  compressProgress.value = 0
  compressMessage.value = '准备压缩...'
  isCompressing.value = true

  const res = await window.api?.compressVideo({
    inputPath,
    outputDir: outputDir.value,
    codec: codec.value,
    crf: crf.value,
    scaleHeight: scaleHeight.value,
    preset: speed.value,
    keepAudio: keepAudio.value,
    duration: duration.value
  })

  if (res && res.canceled) {
    isCompressing.value = false
    compressStatus.value = 'idle'
    compressMessage.value = ''
  }
}
</script>

<template>
  <div class="page">
    <!-- 未选择视频：上传区 -->
    <div v-if="!videoFile" class="upload-wrap">
      <UploadZone
        button-text="选择视频"
        :tips="['点击或拖拽一个视频到此', '压缩后可显著减小文件体积']"
        accept="video/*"
        @select="handleFile"
      />
    </div>

    <!-- 已选择视频 -->
    <div v-else class="compress-view">
      <div class="split">
        <!-- 左列：预览 -->
        <div class="split-left">
          <div class="preview-wrap">
            <video
              ref="videoEl"
              :src="videoUrl"
              controls
              class="preview-video"
              @loadedmetadata="onLoadedMetadata"
            ></video>
          </div>
        </div>

        <!-- 右栏：压缩设置 -->
        <div class="split-right">
          <div class="compress-panel right-panel">
            <!-- 视频信息 -->
            <div class="info-block">
              <div class="file-name-row">
                <div class="file-name" :title="videoFile.name">{{ videoFile.name }}</div>
                <button
                  type="button"
                  class="reset-btn"
                  :disabled="isCompressing"
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

            <!-- 快捷档位 -->
            <div class="setting-block">
              <div class="setting-title">快捷档位</div>
              <div class="preset-grid">
                <button
                  v-for="p in qualityPresets"
                  :key="p.key"
                  type="button"
                  class="preset-btn"
                  :class="{ active: preset === p.key }"
                  :title="p.tip"
                  @click="applyPreset(p)"
                >
                  {{ p.label }}
                </button>
                <button
                  type="button"
                  class="preset-btn"
                  :class="{ active: preset === 'custom' }"
                  @click="preset = 'custom'"
                >
                  自定义
                </button>
              </div>
              <p class="setting-tip">
                {{
                  qualityPresets.find((p) => p.key === preset)?.tip || '自由调整下方参数进行压缩'
                }}
              </p>
            </div>

            <!-- CRF 画质 -->
            <div class="setting-block">
              <div class="setting-title-row">
                <span class="setting-title">画质 (CRF)</span>
                <span class="setting-value">{{ crf }}</span>
              </div>
              <n-slider
                v-model:value="crf"
                :min="18"
                :max="32"
                :step="1"
                :tooltip="false"
                @update:value="onCrfChange"
              />
              <p class="setting-tip">{{ crfTip }}</p>
            </div>

            <!-- 分辨率 -->
            <div class="setting-block">
              <div class="setting-title">分辨率</div>
              <n-radio-group
                v-model:value="resolution"
                size="small"
                @update:value="onResolutionChange"
              >
                <n-radio-button
                  v-for="opt in resolutionOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </n-radio-button>
              </n-radio-group>
            </div>

            <!-- 编码器 -->
            <div class="setting-block">
              <div class="setting-title">编码器</div>
              <n-radio-group v-model:value="codec" size="small" @update:value="markCustom">
                <n-radio-button v-for="opt in codecOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </n-radio-button>
              </n-radio-group>
              <p class="setting-tip">{{ codecOptions.find((o) => o.value === codec)?.tip }}</p>
            </div>

            <!-- 编码速度 -->
            <div class="setting-block">
              <div class="setting-title">编码速度</div>
              <n-radio-group v-model:value="speed" size="small" @update:value="markCustom">
                <n-radio-button v-for="opt in speedOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </n-radio-button>
              </n-radio-group>
            </div>

            <!-- 音轨 -->
            <div class="setting-block row">
              <span class="setting-title">保留音轨</span>
              <n-switch v-model:value="keepAudio" size="small" @update:value="markCustom" />
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
                :disabled="isCompressing"
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
                :disabled="!canCompress"
                @click="applyCompress"
              >
                {{ isCompressing ? '压缩中...' : '开始压缩' }}
              </n-button>
            </div>

            <!-- 进度 / 结果 -->
            <div
              v-if="compressStatus !== 'idle'"
              class="compress-progress"
              :class="'compress-' + compressStatus"
            >
              <n-progress
                type="line"
                :percentage="compressProgress"
                :height="8"
                :show-indicator="false"
                :color="progressColor"
                rail-color="#e2e8f0"
              />
              <p class="progress-message">{{ compressMessage }}</p>
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

/* ---------- 压缩视图 ---------- */
.compress-view {
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

/* ---------- 右栏设置面板 ---------- */
.compress-panel {
  flex: 1;
  min-height: 0;
  padding: 20px;
  overflow-y: auto;
  border: none;
  border-radius: 0;
  background-color: #ffffff;
}

/* 视频信息 */
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

/* 快捷档位按钮 */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.preset-btn {
  padding: 8px 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background-color: #ffffff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s,
    color 0.15s;
}

.preset-btn:hover {
  border-color: #93c5fd;
  color: #2563eb;
}

.preset-btn.active {
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

.compress-progress {
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

.compress-error .progress-message {
  color: #dc2626;
}
</style>
