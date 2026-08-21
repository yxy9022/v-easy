<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import UploadZone from '../components/UploadZone.vue'
import { message, dialog } from '../utils/naive'

const videoFile = ref(null)
const videoUrl = ref('')
const videoEl = ref(null)

const duration = ref(0) // 视频总时长（秒）
const currentTime = ref(0) // 当前播放位置（秒）
const startTime = ref(0) // 待加速片段的开始时间（秒）
const endTime = ref(0) // 待加速片段的结束时间（秒）
const previewEnd = ref(0) // 预览选中片段时的结束时间，0 表示未在预览
const clips = ref([]) // 已添加的加速片段 [{ id, start, end, speed }]
const speed = ref(2) // 当前选择的倍速
const keepAudio = ref(true) // 是否保留声音
let clipId = 0

const speedOptions = [
  { label: '1.5x', value: 1.5 },
  { label: '2x', value: 2 },
  { label: '3x', value: 3 },
  { label: '4x', value: 4 },
  { label: '8x', value: 8 },
  { label: '16x', value: 16 }
]

const fileSizeText = computed(() => {
  if (!videoFile.value) return ''
  const size = videoFile.value.size
  if (size >= 1024 * 1024 * 1024) return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + ' MB'
  return (size / 1024).toFixed(2) + ' KB'
})

const durationText = computed(() => formatTime(duration.value))

/** 预计节省时长（秒） */
const savedTime = computed(() =>
  clips.value.reduce((s, c) => s + (c.end - c.start) * (1 - 1 / c.speed), 0)
)
const savedTimeText = computed(() => formatTime(savedTime.value))
const resultDurationText = computed(() => formatTime(Math.max(0, duration.value - savedTime.value)))

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

/** 双滑块选中区域样式（相对总时长百分比） */
function rangeStyle() {
  if (!duration.value) return { left: '0%', width: '0%' }
  const left = (startTime.value / duration.value) * 100
  const width = ((endTime.value - startTime.value) / duration.value) * 100
  return { left: left + '%', width: width + '%' }
}

function handleFile(file) {
  if (!file.type.startsWith('video/')) {
    message.warning('请选择视频文件')
    return
  }
  videoFile.value = file
  videoUrl.value = URL.createObjectURL(file)
}

function resetVideo() {
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
  videoUrl.value = ''
  videoFile.value = null
  duration.value = 0
  currentTime.value = 0
  startTime.value = 0
  endTime.value = 0
  clips.value = []
}

function confirmResetVideo() {
  dialog.warning({
    title: '重新选择视频',
    content: '确定重新选择视频吗？当前已添加的加速时间段将被清空。',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: resetVideo
  })
}

// ---------- 视频元数据 / 播放同步 ----------
function onLoadedMetadata() {
  duration.value = videoEl.value.duration
  if (isFinite(duration.value)) {
    endTime.value = duration.value
  }
}

function onTimeUpdate() {
  currentTime.value = videoEl.value.currentTime
  if (previewEnd.value && videoEl.value.currentTime >= previewEnd.value) {
    videoEl.value.pause()
    previewEnd.value = 0
  }
}

function onPause() {
  previewEnd.value = 0
  if (videoEl.value) videoEl.value.playbackRate = 1
}

function seekTo(time) {
  if (videoEl.value && isFinite(time)) {
    videoEl.value.pause()
    videoEl.value.playbackRate = 1
    videoEl.value.currentTime = time
  }
}

function previewClipAt(clip) {
  if (!videoEl.value || !duration.value) return
  if (clip.end - clip.start < 0.1) return
  previewEnd.value = clip.end
  // 以该片段的倍速预览播放，模拟加速效果
  videoEl.value.playbackRate = clip.speed
  videoEl.value.currentTime = clip.start
  videoEl.value.play()
}

// ---------- 加速时间段选择 ----------
function onStartInput(e) {
  startTime.value = Math.min(Number(e.target.value), endTime.value - 0.1)
  e.target.value = startTime.value
  seekTo(startTime.value)
}

function onEndInput(e) {
  endTime.value = Math.max(Number(e.target.value), startTime.value + 0.1)
  e.target.value = endTime.value
  seekTo(endTime.value)
}

/** 区间合并：对片段列表做并集，重叠/相邻区间合并，返回按开始时间有序的新列表 */
function mergeClips(list) {
  const sorted = [...list].sort((a, b) => a.start - b.start)
  const result = []
  for (const clip of sorted) {
    const last = result[result.length - 1]
    if (last && clip.start <= last.end) {
      if (clip.end > last.end) last.end = clip.end
    } else {
      result.push({ ...clip })
    }
  }
  return result
}

function addClip() {
  if (endTime.value - startTime.value < 0.1) {
    message.warning('时间段过短，请先调整开始/结束时间')
    return
  }
  const before = clips.value.length
  clips.value = mergeClips([
    ...clips.value,
    { id: ++clipId, start: startTime.value, end: endTime.value, speed: speed.value }
  ])
  if (clips.value.length < before + 1) {
    message.info('该时间段与已有片段重叠（或相邻），已自动合并')
  }
}

function removeClip(id) {
  clips.value = clips.value.filter((c) => c.id !== id)
}

function clearClips() {
  clips.value = []
}

function clipStyle(clip) {
  if (!duration.value) return { left: '0%', width: '0%' }
  const left = (clip.start / duration.value) * 100
  const width = ((clip.end - clip.start) / duration.value) * 100
  return { left: left + '%', width: width + '%' }
}

// ---------- 加速导出（ffmpeg） ----------
const isProcessing = ref(false)
const speedProgress = ref(0)
const speedStatus = ref('idle') // idle | running | done | error
const speedMessage = ref('')
const outputDir = ref('')

let offProgress = null
let offDone = null
let offError = null

onMounted(() => {
  window.api?.getDesktopPath?.().then((p) => {
    if (p) outputDir.value = p
  })

  offProgress = window.api?.onSpeedProgress((data) => {
    speedProgress.value = data.percent
    speedMessage.value = data.message
  })
  offDone = window.api?.onSpeedDone((data) => {
    isProcessing.value = false
    speedStatus.value = 'done'
    speedMessage.value = `已导出：${data.outputPath}`
  })
  offError = window.api?.onSpeedError((data) => {
    isProcessing.value = false
    speedStatus.value = 'error'
    speedMessage.value = `加速失败：${data.message}`
  })
})

onUnmounted(() => {
  offProgress?.()
  offDone?.()
  offError?.()
})

const canStart = computed(() => clips.value.length > 0 && !isProcessing.value && !!outputDir.value)

const progressColor = computed(() => {
  if (speedStatus.value === 'error') return '#dc2626'
  if (speedStatus.value === 'done') return '#22c55e'
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

async function applySpeed() {
  if (!videoFile.value || !clips.value.length) return

  if (!outputDir.value) {
    message.warning('请先选择保存目录')
    return
  }

  const inputPath = window.api?.getPathForFile(videoFile.value)
  if (!inputPath) {
    speedStatus.value = 'error'
    speedMessage.value = '无法获取视频文件路径'
    return
  }

  speedStatus.value = 'running'
  speedProgress.value = 0
  speedMessage.value = '准备加速...'
  isProcessing.value = true

  const res = await window.api?.speedVideo({
    inputPath,
    // 转成普通对象数组（Vue 响应式 Proxy 无法被 IPC 克隆）
    clips: clips.value.map((c) => ({ start: c.start, end: c.end, speed: c.speed })),
    duration: duration.value,
    outputDir: outputDir.value,
    keepAudio: keepAudio.value
  })

  if (res && res.canceled) {
    isProcessing.value = false
    speedStatus.value = 'idle'
    speedMessage.value = ''
  }
}
</script>

<template>
  <div class="page">
    <!-- 未选择视频：通用上传/拖拽组件 -->
    <div v-if="!videoFile" class="upload-wrap">
      <UploadZone
        button-text="上传视频"
        :tips="['拖拽视频到此或点击上传', '支持 MP4、MOV、AVI 等常见视频格式']"
        accept="video/*"
        @select="handleFile"
      />
    </div>

    <!-- 已选择视频 -->
    <div v-else class="video-preview">
      <div class="split">
        <!-- 左列：视频预览 + 时间段选择 -->
        <div class="split-left">
          <div class="video-wrap">
            <video
              ref="videoEl"
              :src="videoUrl"
              controls
              class="video-el"
              @loadedmetadata="onLoadedMetadata"
              @timeupdate="onTimeUpdate"
              @pause="onPause"
            ></video>
          </div>

          <div class="video-info">
            <span class="file-name">{{ videoFile.name }}</span>
            <span class="file-size">{{ fileSizeText }}</span>
            <span v-if="duration" class="file-size">总时长 {{ durationText }}</span>
          </div>

          <div v-if="duration" class="crop-panel">
            <div class="crop-header">
              <span>拖动下面的滑块，选取要加速的时间段</span>
            </div>

            <!-- 双滑块时间范围选择 -->
            <div class="range-track">
              <div class="range-bg"></div>
              <div
                v-for="clip in clips"
                :key="clip.id"
                class="range-clip"
                :style="clipStyle(clip)"
              ></div>
              <div class="range-selected" :style="rangeStyle()"></div>
              <input
                type="range"
                class="range-input range-start"
                :min="0"
                :max="duration"
                step="0.01"
                :value="startTime"
                @input="onStartInput"
              />
              <input
                type="range"
                class="range-input"
                :min="0"
                :max="duration"
                step="0.01"
                :value="endTime"
                @input="onEndInput"
              />
            </div>

            <div class="speed-row">
              <span class="setting-title">加速倍速</span>
              <div class="opt-group">
                <button
                  v-for="opt in speedOptions"
                  :key="opt.value"
                  type="button"
                  class="opt-btn"
                  :class="{ active: speed === opt.value }"
                  @click="speed = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <div class="crop-actions">
              <n-button size="medium" @click="confirmResetVideo">重新选择视频</n-button>
              <n-button
                size="medium"
                type="primary"
                secondary
                :disabled="isProcessing"
                @click="addClip"
              >
                添加为加速片段
              </n-button>
            </div>
          </div>
        </div>

        <!-- 右列：已添加片段列表 + 加速应用 -->
        <div v-if="duration" class="split-right">
          <div class="crop-panel right-panel">
            <div class="clips-panel">
              <div class="clips-header">
                <span class="clips-title">将加速 {{ clips.length }} 个时间段</span>
                <div class="clips-actions">
                  <n-button size="tiny" @click="clearClips">清空</n-button>
                </div>
              </div>
              <ul v-if="clips.length" class="clip-list">
                <li v-for="(clip, index) in clips" :key="clip.id" class="clip-item">
                  <span class="clip-index">{{ index + 1 }}</span>
                  <span class="clip-time">{{ formatTime(clip.start) }}</span>
                  <span class="clip-arrow">→</span>
                  <span class="clip-time">{{ formatTime(clip.end) }}</span>
                  <span class="clip-speed">×{{ clip.speed }}</span>
                  <span class="clip-footer">
                    <span class="clip-duration">
                      原时长 {{ formatTime(clip.end - clip.start) }} →
                      {{ formatTime((clip.end - clip.start) / clip.speed) }}
                    </span>
                    <span class="clip-actions">
                      <n-button size="tiny" :disabled="isProcessing" @click="previewClipAt(clip)">
                        预览
                      </n-button>
                      <n-button size="tiny" type="error" quaternary @click="removeClip(clip.id)">
                        删除
                      </n-button>
                    </span>
                  </span>
                </li>
              </ul>
              <n-empty
                v-else
                class="clips-empty"
                size="small"
                description="暂无加速片段，先在左侧框选并添加"
              />
            </div>

            <div class="result-bar">
              <div class="result-item">
                <span class="result-label">原时长</span>
                <span class="result-value">{{ durationText }}</span>
              </div>
              <div class="result-item">
                <span class="result-label">预计节省</span>
                <span class="result-value result-saved">-{{ savedTimeText }}</span>
              </div>
              <div class="result-item">
                <span class="result-label">加速后</span>
                <span class="result-value result-after">{{ resultDurationText }}</span>
              </div>
            </div>

            <!-- 声音 -->
            <div class="setting-row">
              <span class="setting-title">保留声音</span>
              <n-switch v-model:value="keepAudio" size="small" />
            </div>

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
                :disabled="isProcessing"
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
              <n-button type="primary" size="large" block :disabled="!canStart" @click="applySpeed">
                {{ isProcessing ? '处理中...' : '开始处理' }}
              </n-button>
            </div>

            <!-- 加速进度 -->
            <div v-if="speedStatus !== 'idle'" class="crop-progress" :class="'crop-' + speedStatus">
              <n-progress
                type="line"
                :percentage="speedProgress"
                :height="8"
                :show-indicator="false"
                :color="progressColor"
                rail-color="#e2e8f0"
              />
              <p class="progress-message">{{ speedMessage }}</p>
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

/* ---------- 视频预览 ---------- */
.video-preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  gap: 12px;
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

.video-wrap {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.video-el {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 12px;
  background-color: #000000;
}

.video-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: auto;
  padding-left: 16px;
}

.file-name {
  font-weight: 600;
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  color: #94a3b8;
  font-size: 13px;
  flex-shrink: 0;
}

/* ---------- 面板 ---------- */
.crop-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
  padding: 16px 16px 24px 16px;
  border: none;
  border-radius: 0;
  background-color: #ffffff;
}

.right-panel {
  flex: 1;
  min-height: 0;
}

.crop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: #334155;
}

/* 倍速选择行 */
.speed-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
}

/* 设置行（开关类） */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.setting-title {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

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

/* 双滑块轨道 */
.range-track {
  position: relative;
  height: 24px;
}

.range-bg {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 6px;
  transform: translateY(-50%);
  border-radius: 3px;
  background-color: #e2e8f0;
}

.range-selected {
  position: absolute;
  top: 50%;
  height: 6px;
  transform: translateY(-50%);
  border-radius: 3px;
  background-color: #2563eb;
}

.range-clip {
  position: absolute;
  top: 50%;
  height: 6px;
  transform: translateY(-50%);
  border-radius: 3px;
  background-color: #93c5fd;
}

.range-input {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  height: 24px;
  margin: 0;
  background: transparent;
  appearance: none;
  -webkit-appearance: none;
  pointer-events: none;
}

.range-start {
  z-index: 2;
}

.range-input::-webkit-slider-runnable-track {
  height: 6px;
  background: transparent;
}

.range-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  pointer-events: auto;
  width: 10px;
  height: 18px;
  margin-top: -6px;
  background-color: #ffffff;
  background-image: linear-gradient(
    to right,
    transparent 38%,
    #2563eb 38%,
    #2563eb 62%,
    transparent 62%
  );
  border: 1px solid #cbd5e1;
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  cursor: pointer;
}

.range-input:focus {
  outline: none;
}

.crop-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 12px;
}

/* ---------- 片段列表 ---------- */
.clips-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border-top: 1px solid #e2e8f0;
  padding-top: 12px;
}

.right-panel .clips-panel {
  border-top: none;
  padding-top: 0;
}

.clips-empty {
  padding: 48px 0 12px;
}

.clips-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.clips-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.clips-title {
  font-weight: 600;
  font-size: 14px;
  color: #334155;
}

.clip-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 4px 4px 0;
  list-style: none;
  overflow-y: auto;
}

.clip-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background-color: #f8fafc;
  font-size: 13px;
}

.clip-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: #2563eb;
  color: #ffffff;
  font-size: 11px;
  flex-shrink: 0;
}

.clip-time {
  font-variant-numeric: tabular-nums;
  color: #334155;
}

.clip-arrow {
  color: #94a3b8;
}

.clip-speed {
  padding: 1px 8px;
  border-radius: 10px;
  background-color: #eff6ff;
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
}

.clip-footer {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.clip-duration {
  font-variant-numeric: tabular-nums;
  color: #94a3b8;
  font-size: 12px;
}

.clip-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ---------- 预计结果 ---------- */
.result-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
}

.result-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.result-label {
  font-size: 11px;
  color: #94a3b8;
}

.result-value {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  font-variant-numeric: tabular-nums;
}

.result-saved {
  color: #16a34a;
}

.result-after {
  color: #2563eb;
}

/* 保存目录选择 */
.output-dir {
  display: flex;
  align-items: center;
  gap: 8px;
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
  display: flex;
  margin-top: 4px;
}

/* ---------- 进度 ---------- */
.crop-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.crop-error .progress-message {
  color: #dc2626;
}

.crop-done .progress-message {
  color: #16a34a;
}
</style>
