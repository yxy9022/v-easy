<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import UploadZone from '../components/UploadZone.vue'
import { message, dialog } from '../utils/naive'

const videoFile = ref(null)
const videoUrl = ref('')
const videoEl = ref(null)
const videoWrapEl = ref(null)
const stageEl = ref(null)
// 视频画面在 zoom=1 时的基础尺寸（按容器 contain 缩放后）
const stageSize = ref({ w: 0, h: 0 })
const zoom = ref(1) // 视频缩放比例
const minZoom = 0.5
const maxZoom = 3
const zoomStep = 0.1

const duration = ref(0) // 视频总时长（秒）
const videoWidth = ref(0) // 视频原始宽度（像素）
const videoHeight = ref(0) // 视频原始高度（像素）
const currentTime = ref(0) // 当前播放位置（秒）
const isPlaying = ref(false) // 是否正在播放

// 去水印区域列表：{ id, name, displayRect, sourceRect, startTime, endTime }
const regions = ref([])
const activeId = ref(null)
const isAddingNew = ref(false) // 是否正在新增选区
const tempRect = ref(null) // 新增选区时的预览矩形
let nextId = 1

const fileSizeText = computed(() => {
  if (!videoFile.value) return ''
  const size = videoFile.value.size
  if (size >= 1024 * 1024 * 1024) return (size / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + ' MB'
  return (size / 1024).toFixed(2) + ' KB'
})

const durationText = computed(() => formatTime(duration.value))

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

function parseTime(text) {
  const parts = String(text || '00:00:00').split(':')
  const h = Number(parts[0]) || 0
  const m = Math.min(59, Math.max(0, Number(parts[1]) || 0))
  const s = Math.min(59, Math.max(0, Number(parts[2]) || 0))
  return h * 3600 + m * 60 + s
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
  videoWidth.value = 0
  videoHeight.value = 0
  currentTime.value = 0
  isPlaying.value = false
  regions.value = []
  activeId.value = null
  isAddingNew.value = false
  tempRect.value = null
  nextId = 1
  zoom.value = 1
  stageSize.value = { w: 0, h: 0 }
}

function confirmResetVideo() {
  dialog.warning({
    title: '重新选择视频',
    content: '确定重新选择视频吗？当前框选的水印区域将被清空。',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: resetVideo
  })
}

// ---------- 视频元数据 / 播放控制 ----------
function onLoadedMetadata() {
  duration.value = videoEl.value.duration
  videoWidth.value = videoEl.value.videoWidth
  videoHeight.value = videoEl.value.videoHeight
  requestAnimationFrame(updateDispRect)
}

function onTimeUpdate() {
  currentTime.value = videoEl.value.currentTime
}

function onPlay() {
  isPlaying.value = true
}

function onPause() {
  isPlaying.value = false
}

function onVideoClick() {
  if (isAddingNew.value) return
  togglePlay()
}

function togglePlay() {
  const el = videoEl.value
  if (!el) return
  if (el.paused) el.play()
  else el.pause()
}

function onSeek(e) {
  const t = Number(e.target.value)
  if (!isFinite(t)) return
  videoEl.value.currentTime = t
  currentTime.value = t
}

const rangeStyle = computed(() => {
  if (!duration.value) return {}
  const pct = Math.min(100, (currentTime.value / duration.value) * 100)
  return { background: `linear-gradient(to right, #2563eb ${pct}%, #e2e8f0 ${pct}%)` }
})

const timeText = computed(() => `${formatTime(currentTime.value)} / ${formatTime(duration.value)}`)

const zoomPercent = computed(() => Math.round(zoom.value * 100) + '%')

function zoomIn() {
  setZoom(Math.min(maxZoom, zoom.value + zoomStep))
}

function zoomOut() {
  setZoom(Math.max(minZoom, zoom.value - zoomStep))
}

function setZoom(newZoom) {
  const ratio = newZoom / zoom.value
  zoom.value = newZoom
  regions.value.forEach((r) => {
    r.displayRect = {
      x: r.displayRect.x * ratio,
      y: r.displayRect.y * ratio,
      w: r.displayRect.w * ratio,
      h: r.displayRect.h * ratio
    }
    r.sourceRect = toSourceRect(r.displayRect)
  })
}

function resetZoom() {
  setZoom(1)
}

async function toggleFullscreen() {
  const el = videoWrapEl.value
  if (!el) return
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await el.requestFullscreen()
    }
  } catch (err) {
    message.warning('全屏切换失败')
  }
}

// ---------- 多选区管理 ----------
function addRegion() {
  isAddingNew.value = true
  activeId.value = null
  tempRect.value = null
  videoEl.value?.pause()
}

function removeRegion(id) {
  regions.value = regions.value.filter((r) => r.id !== id)
  if (activeId.value === id) activeId.value = null
}

function setActive(id) {
  activeId.value = id
  isAddingNew.value = false
  tempRect.value = null
}

function updateRegionTime(region, field, value) {
  const sec = parseTime(value)
  region[field] = sec
  // 简单校正：开始不能大于结束
  if (field === 'startTime' && sec > region.endTime) {
    region.endTime = Math.min(duration.value, sec + 1)
  }
  if (field === 'endTime' && sec < region.startTime) {
    region.startTime = Math.max(0, sec - 1)
  }
  if (region.startTime > region.endTime) {
    const t = region.startTime
    region.startTime = region.endTime
    region.endTime = t
  }
}

/** 计算视频画面在 zoom=1 时的基础尺寸（按容器 contain 等比缩放） */
function updateDispRect() {
  const wrap = videoWrapEl.value
  if (!wrap || !videoWidth.value || !videoHeight.value) return
  const wrapRect = wrap.getBoundingClientRect()
  const scale = Math.min(wrapRect.width / videoWidth.value, wrapRect.height / videoHeight.value)
  stageSize.value = {
    w: videoWidth.value * scale,
    h: videoHeight.value * scale
  }
}

/** 当前显示像素与视频原始像素的比例 */
const currentScale = computed(() => {
  if (!stageSize.value.w || !videoWidth.value || !zoom.value) return 0
  return (stageSize.value.w * zoom.value) / videoWidth.value
})

/** 把画面坐标转换为视频原始分辨率坐标 */
function toSourceRect(displayRect) {
  if (!displayRect || !videoWidth.value || !videoHeight.value) return null
  const scale = currentScale.value
  if (!scale) return null
  const x = Math.round(Math.max(0, displayRect.x / scale))
  const y = Math.round(Math.max(0, displayRect.y / scale))
  const w = Math.round(Math.min(displayRect.w / scale, videoWidth.value - x))
  const h = Math.round(Math.min(displayRect.h / scale, videoHeight.value - y))
  if (w < 1 || h < 1) return null
  return { x, y, w, h }
}

let drag = null // { mode, startX, startY, id?, origin? }

function isOnHandle(sx, sy, rect) {
  return (
    sx >= rect.x + rect.w - 12 &&
    sx <= rect.x + rect.w + 4 &&
    sy >= rect.y + rect.h - 12 &&
    sy <= rect.y + rect.h + 4
  )
}

function isInsideRect(sx, sy, rect) {
  return sx >= rect.x && sx <= rect.x + rect.w && sy >= rect.y && sy <= rect.y + rect.h
}

function clampRect(x, y, w, h, minX, minY, maxX, maxY) {
  if (w < 10 || h < 10) return { x, y, w, h }
  x = Math.min(Math.max(x, minX), maxX - w)
  y = Math.min(Math.max(y, minY), maxY - h)
  w = Math.min(w, maxX - x)
  h = Math.min(h, maxY - y)
  return { x, y, w, h }
}

function onOverlayMouseDown(e) {
  const stage = stageEl.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top

  // 只允许在视频画面区域内操作，黑边区域直接忽略
  if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) return

  if (isAddingNew.value) {
    drag = { mode: 'create', startX: e.clientX, startY: e.clientY }
    tempRect.value = { x: sx, y: sy, w: 0, h: 0 }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return
  }

  // 从后往前找命中的选区（后面的在上面）
  const hit = [...regions.value].reverse().find((r) => isInsideRect(sx, sy, r.displayRect))
  if (hit) {
    activeId.value = hit.id
    if (isOnHandle(sx, sy, hit.displayRect)) {
      drag = {
        mode: 'resize',
        id: hit.id,
        startX: e.clientX,
        startY: e.clientY,
        origin: { ...hit.displayRect }
      }
    } else {
      drag = {
        mode: 'move',
        id: hit.id,
        startX: e.clientX,
        startY: e.clientY,
        origin: { ...hit.displayRect }
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }
}

function onMouseMove(e) {
  if (!drag) return
  const stage = stageEl.value
  if (!stage) return
  const dx = e.clientX - drag.startX
  const dy = e.clientY - drag.startY
  // 坐标原点即视频画面左上角，限制范围从 0 开始
  const minX = 0
  const minY = 0
  const maxX = stageSize.value.w * zoom.value
  const maxY = stageSize.value.h * zoom.value

  if (drag.mode === 'create') {
    const rect = stage.getBoundingClientRect()
    let x = drag.startX - rect.left
    let y = drag.startY - rect.top
    let w = dx
    let h = dy
    if (w < 0) {
      x += w
      w = -w
    }
    if (h < 0) {
      y += h
      h = -h
    }
    tempRect.value = clampRect(x, y, w, h, minX, minY, maxX, maxY)
  } else {
    const region = regions.value.find((r) => r.id === drag.id)
    if (!region) return
    if (drag.mode === 'move') {
      const origin = drag.origin
      const x = Math.min(Math.max(origin.x + dx, minX), maxX - origin.w)
      const y = Math.min(Math.max(origin.y + dy, minY), maxY - origin.h)
      region.displayRect = { ...origin, x, y }
    } else {
      const origin = drag.origin
      const w = Math.min(Math.max(origin.w + dx, 10), maxX - origin.x)
      const h = Math.min(Math.max(origin.h + dy, 10), maxY - origin.y)
      region.displayRect = { ...origin, w, h }
    }
    region.sourceRect = toSourceRect(region.displayRect)
  }
}

function onMouseUp() {
  if (drag?.mode === 'create' && tempRect.value) {
    const { x, y, w, h } = tempRect.value
    if (w >= 10 && h >= 10) {
      const displayRect = { x, y, w, h }
      const sourceRect = toSourceRect(displayRect)
      if (sourceRect) {
        const id = nextId++
        regions.value.push({
          id,
          name: `选区${id}`,
          displayRect,
          sourceRect,
          startTime: 0,
          endTime: duration.value || 0
        })
        activeId.value = id
      }
    }
  }
  drag = null
  tempRect.value = null
  isAddingNew.value = false
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

function selectionStyle(rect) {
  return {
    left: rect.x + 'px',
    top: rect.y + 'px',
    width: rect.w + 'px',
    height: rect.h + 'px'
  }
}

/** 视频舞台尺寸：随缩放比例变化 */
const stageStyle = computed(() => ({
  width: stageSize.value.w * zoom.value + 'px',
  height: stageSize.value.h * zoom.value + 'px'
}))

function clearAllRegions() {
  regions.value = []
  activeId.value = null
  isAddingNew.value = false
  nextId = 1
}

// ---------- 去水印导出（ffmpeg） ----------
const isRemoving = ref(false)
const wmProgress = ref(0)
const wmStatus = ref('idle') // idle | running | done | error
const wmMessage = ref('')
const outputDir = ref('')

let offProgress = null
let offDone = null
let offError = null
let resizeObserver = null

onMounted(() => {
  window.api?.getDesktopPath?.().then((p) => {
    if (p) outputDir.value = p
  })

  offProgress = window.api?.onWatermarkProgress((data) => {
    wmProgress.value = data.percent
    wmMessage.value = data.message
  })
  offDone = window.api?.onWatermarkDone((data) => {
    isRemoving.value = false
    wmStatus.value = 'done'
    wmMessage.value = `已导出：${data.outputPath}`
  })
  offError = window.api?.onWatermarkError((data) => {
    isRemoving.value = false
    wmStatus.value = 'error'
    wmMessage.value = `去水印失败：${data.message}`
  })

  // 容器尺寸变化时重算视频画面显示区域
  if (videoWrapEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => updateDispRect())
    resizeObserver.observe(videoWrapEl.value)
  }
})

onUnmounted(() => {
  offProgress?.()
  offDone?.()
  offError?.()
  resizeObserver?.disconnect()
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})

const canRemove = computed(() => regions.value.length > 0 && !isRemoving.value && !!outputDir.value)

const progressColor = computed(() => {
  if (wmStatus.value === 'error') return '#dc2626'
  if (wmStatus.value === 'done') return '#22c55e'
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

async function applyWatermark() {
  if (!videoFile.value || regions.value.length === 0) return

  if (!outputDir.value) {
    message.warning('请先选择保存目录')
    return
  }

  const inputPath = window.api?.getPathForFile(videoFile.value)
  if (!inputPath) {
    wmStatus.value = 'error'
    wmMessage.value = '无法获取视频文件路径'
    return
  }

  wmStatus.value = 'running'
  wmProgress.value = 0
  wmMessage.value = '准备去水印...'
  isRemoving.value = true

  const res = await window.api?.removeWatermark({
    inputPath,
    regions: regions.value.map((r) => ({
      ...r.sourceRect,
      startTime: r.startTime,
      endTime: r.endTime
    })),
    videoWidth: videoWidth.value,
    videoHeight: videoHeight.value,
    duration: duration.value,
    outputDir: outputDir.value
  })

  if (res && res.canceled) {
    isRemoving.value = false
    wmStatus.value = 'idle'
    wmMessage.value = ''
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
        <!-- 左列：视频预览 + 框选水印区域 -->
        <div class="split-left">
          <div ref="videoWrapEl" class="video-wrap">
            <div ref="stageEl" class="video-stage" :style="stageStyle">
              <video
                ref="videoEl"
                :src="videoUrl"
                class="video-el"
                @loadedmetadata="onLoadedMetadata"
                @timeupdate="onTimeUpdate"
                @play="onPlay"
                @pause="onPause"
                @click="onVideoClick"
              ></video>

              <!-- 框选层：精确覆盖视频画面区域（不含黑边），显示/编辑所有选区 -->
              <div
                class="wm-overlay"
                :class="{ adding: isAddingNew }"
                @mousedown.prevent="onOverlayMouseDown"
              >
              <div
                v-for="r in regions"
                :key="r.id"
                class="wm-selection"
                :class="{ active: r.id === activeId }"
                :style="selectionStyle(r.displayRect)"
              >
                <span class="wm-label">{{ r.name }}</span>
                <div v-if="r.id === activeId" class="wm-handle"></div>
              </div>

              <!-- 新增选区时的预览矩形 -->
              <div
                v-if="tempRect"
                class="wm-selection temp"
                :style="selectionStyle(tempRect)"
              ></div>

              <!-- 新增模式提示 -->
              <div v-if="isAddingNew" class="wm-hint">在画面上拖拽框选新的水印区域</div>
            </div>
          </div>
          </div>

          <!-- 自定义控制栏：播放/暂停 + 进度条 + 时间 -->
          <div class="video-controls">
            <button
              type="button"
              class="play-btn"
              :class="{ paused: !isPlaying }"
              @click="togglePlay"
            >
              <svg v-if="isPlaying" class="play-icon" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              <svg v-else class="play-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <input
              type="range"
              class="controls-range"
              :min="0"
              :max="duration || 0"
              step="0.01"
              :value="currentTime"
              :style="rangeStyle"
              @input="onSeek"
            />
            <span class="controls-time">{{ timeText }}</span>

            <div class="zoom-controls">
              <button type="button" class="zoom-btn" :disabled="zoom <= minZoom" @click="zoomOut">
                <svg class="zoom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
              <span class="zoom-value" @click="resetZoom">{{ zoomPercent }}</span>
              <button type="button" class="zoom-btn" :disabled="zoom >= maxZoom" @click="zoomIn">
                <svg class="zoom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
              <button type="button" class="zoom-btn fullscreen" @click="toggleFullscreen">
                <svg class="zoom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              </button>
            </div>
          </div>

          <div class="video-info">
            <span class="file-name">{{ videoFile.name }}</span>
            <span class="file-size">{{ fileSizeText }}</span>
            <span v-if="duration" class="file-size">总时长 {{ durationText }}</span>
          </div>

          <div class="crop-panel">
            <div class="crop-header">
              <span>右侧「新增去水印区域」，在画面上拖拽框住水印</span>
            </div>

            <div class="crop-actions">
              <n-button size="medium" @click="confirmResetVideo">重新选择视频</n-button>
              <n-button
                size="medium"
                type="primary"
                secondary
                :disabled="!regions.length"
                @click="clearAllRegions"
              >
                清除全部
              </n-button>
            </div>
          </div>
        </div>

        <!-- 右列：选区列表 + 去水印应用 -->
        <div class="split-right">
          <div class="crop-panel right-panel">
            <n-button type="primary" block :disabled="isAddingNew" @click="addRegion">
              <template #icon>
                <svg
                  class="add-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </template>
              新增去水印区域
            </n-button>

            <div class="wm-section">
              <div class="clips-header">
                <span class="clips-title">已选区域</span>
                <span class="clips-count">{{ regions.length }} 个</span>
              </div>

              <div v-if="regions.length" class="region-list">
                <div
                  v-for="r in regions"
                  :key="r.id"
                  class="region-item"
                  :class="{ active: r.id === activeId }"
                  @click="setActive(r.id)"
                >
                  <span class="region-index">{{ r.name }}</span>
                  <div class="region-time">
                    <input
                      class="time-input"
                      :value="formatTime(r.startTime)"
                      @blur="updateRegionTime(r, 'startTime', $event.target.value)"
                      @keydown.enter="$event.target.blur()"
                    />
                    <span class="time-sep">-</span>
                    <input
                      class="time-input"
                      :value="formatTime(r.endTime)"
                      @blur="updateRegionTime(r, 'endTime', $event.target.value)"
                      @keydown.enter="$event.target.blur()"
                    />
                  </div>
                  <n-button
                    quaternary
                    circle
                    size="small"
                    class="region-delete"
                    @click.stop="removeRegion(r.id)"
                  >
                    <template #icon>
                      <svg
                        class="delete-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path
                          d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                        />
                      </svg>
                    </template>
                  </n-button>
                </div>
              </div>

              <n-empty
                v-else
                class="clips-empty"
                size="small"
                description="尚未框选水印区域，点击上方按钮新增"
              />
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
                :disabled="isRemoving"
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
                :disabled="!canRemove"
                @click="applyWatermark"
              >
                {{ isRemoving ? '去水印中...' : '开始去水印' }}
              </n-button>
            </div>

            <!-- 去水印进度 -->
            <div v-if="wmStatus !== 'idle'" class="crop-progress" :class="'crop-' + wmStatus">
              <n-progress
                type="line"
                :percentage="wmProgress"
                :height="8"
                :show-indicator="false"
                :color="progressColor"
                rail-color="#e2e8f0"
              />
              <p class="progress-message">{{ wmMessage }}</p>
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
  /* 左右 -28px 抵消 .content 左右 padding(28px)，让内容左右也贴边 */
  margin: 0 -28px;
}

/* 未选择视频：上传区在页面中垂直水平居中 */
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

/* 左右分栏布局：右栏绝对定位贴住 .content 的上下左右边缘 */
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
  /* 让出右栏宽度（340px），与右栏左边缘贴齐，无间距 */
  margin-right: 340px;
  /* 底部 -24px 抵消 .content 的 padding-bottom */
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
  width: 340px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.video-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background-color: #000000;
}

.video-stage {
  position: relative;
  flex-shrink: 0;
  background-color: #000000;
}

.video-el {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 0;
  background-color: #000000;
}

/* 框选层：铺满视频舞台（即视频画面区域，不含黑边） */
.wm-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
}

.wm-overlay.adding {
  cursor: crosshair;
  background-color: rgba(0, 0, 0, 0.15);
}

/* 选区框 */
.wm-selection {
  position: absolute;
  border: 2px solid #94a3b8;
  background-color: rgba(148, 163, 184, 0.15);
  cursor: move;
}

.wm-selection.active {
  border-color: #2563eb;
  background-color: rgba(37, 99, 235, 0.18);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
  z-index: 2;
}

.wm-selection.temp {
  border-color: #2563eb;
  background-color: rgba(37, 99, 235, 0.18);
  cursor: crosshair;
}

.wm-label {
  position: absolute;
  top: -20px;
  left: 0;
  padding: 1px 6px;
  border-radius: 4px;
  background-color: #94a3b8;
  color: #ffffff;
  font-size: 11px;
  white-space: nowrap;
}

.wm-selection.active .wm-label {
  background-color: #2563eb;
}

/* 右下角缩放手柄 */
.wm-handle {
  position: absolute;
  right: -7px;
  bottom: -7px;
  width: 12px;
  height: 12px;
  border: 2px solid #ffffff;
  border-radius: 3px;
  background-color: #2563eb;
  cursor: nwse-resize;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.wm-hint {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  padding: 6px 14px;
  border-radius: 8px;
  background-color: #0f172a;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
}

/* ---------- 自定义播放控制栏 ---------- */
.video-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  flex-shrink: 0;
  border-radius: 10px;
  background-color: #ffffff;
  border: 1px solid #e2e8f0;
}

.play-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background-color: #2563eb;
  color: #ffffff;
  cursor: pointer;
  transition: background-color 0.15s;
}

.play-btn:hover {
  background-color: #1d4ed8;
}

.play-icon {
  width: 16px;
  height: 16px;
}

.controls-range {
  flex: 1;
  min-width: 0;
  height: 4px;
  margin: 0;
  -webkit-appearance: none;
  appearance: none;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.controls-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: transparent;
}

.controls-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background-color: #2563eb;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}

.controls-time {
  flex-shrink: 0;
  font-size: 12px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding-left: 8px;
  border-left: 1px solid #e2e8f0;
}

.zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background-color: #ffffff;
  color: #475569;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s;
}

.zoom-btn:hover:not(:disabled) {
  border-color: #2563eb;
  color: #2563eb;
  background-color: #eff6ff;
}

.zoom-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.zoom-icon {
  width: 14px;
  height: 14px;
}

.zoom-value {
  min-width: 42px;
  text-align: center;
  font-size: 12px;
  color: #334155;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  user-select: none;
}

.zoom-value:hover {
  color: #2563eb;
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

/* ---------- 通用面板（与裁剪页保持一致） ---------- */
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
  overflow-y: auto;
}

.crop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: #334155;
}

.crop-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

/* ---------- 选区列表 ---------- */
.wm-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border-top: 1px solid #e2e8f0;
  padding-top: 12px;
}

.clips-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.clips-title {
  font-weight: 600;
  font-size: 14px;
  color: #334155;
}

.clips-count {
  font-size: 12px;
  color: #94a3b8;
}

.region-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.region-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background-color: #f8fafc;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s;
}

.region-item:hover {
  border-color: #cbd5e1;
}

.region-item.active {
  border-color: #2563eb;
  background-color: #eff6ff;
}

.region-index {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 4px;
  background-color: #e2e8f0;
  color: #475569;
  font-size: 12px;
  font-weight: 600;
}

.region-item.active .region-index {
  background-color: #2563eb;
  color: #ffffff;
}

.region-time {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.time-input {
  width: 72px;
  padding: 4px 6px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background-color: #ffffff;
  color: #334155;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  outline: none;
}

.time-input:focus {
  border-color: #2563eb;
}

.time-sep {
  color: #94a3b8;
  font-size: 12px;
}

.region-delete {
  flex-shrink: 0;
}

.delete-icon {
  width: 14px;
  height: 14px;
}

.add-icon {
  width: 16px;
  height: 16px;
}

.clips-empty {
  padding: 48px 0 12px;
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

/* ---------- 去水印进度 ---------- */
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
