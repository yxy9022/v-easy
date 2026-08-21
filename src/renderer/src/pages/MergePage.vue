<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import UploadZone from '../components/UploadZone.vue'
import { message } from '../utils/naive'

// 视频列表：[{ id, file, duration, thumbnail }]
const videos = ref([])
const activeId = ref(null)
const activeUrl = ref('')
let nextId = 1

const stripEl = ref(null)
const fileInput = ref(null)

const isMerging = ref(false)
const mergeProgress = ref(0)
const mergeStatus = ref('idle') // idle | running | done | error
const mergeMessage = ref('')
const outputDir = ref('')

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

const activeVideo = computed(() => videos.value.find((v) => v.id === activeId.value))

const totalDurationText = computed(() => {
  const total = videos.value.reduce((s, v) => s + (v.duration || 0), 0)
  return formatTime(total)
})

function updateActiveUrl() {
  if (activeUrl.value) URL.revokeObjectURL(activeUrl.value)
  activeUrl.value = activeVideo.value ? URL.createObjectURL(activeVideo.value.file) : ''
}

watch(() => activeVideo.value?.id, updateActiveUrl)

/** 生成视频缩略图（居中裁剪，正方形 160x160） */
async function captureThumbnail(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.src = url

    let settled = false
    const done = (thumb) => {
      if (settled) return
      settled = true
      video.onloadeddata = null
      video.onloadedmetadata = null
      video.onseeked = null
      video.onerror = null
      video.src = ''
      URL.revokeObjectURL(url)
      resolve(thumb)
    }

    const draw = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = 160
        const vw = video.videoWidth || 640
        const vh = video.videoHeight || 360
        const scale = Math.max(size / vw, size / vh)
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        const drawW = vw * scale
        const drawH = vh * scale
        ctx.drawImage(
          video,
          0,
          0,
          vw,
          vh,
          (size - drawW) / 2,
          (size - drawH) / 2,
          drawW,
          drawH
        )
        done(canvas.toDataURL('image/jpeg', 0.7))
      } catch (e) {
        done('')
      }
    }

    // loadeddata 触发说明首帧已就绪，直接绘制
    video.onloadeddata = draw
    // 部分环境 preload 下不触发 loadeddata，seek 到 1 秒处再绘制
    video.onloadedmetadata = () => {
      try {
        if (video.seekable.length && video.duration > 0) {
          video.currentTime = Math.min(video.duration, 1)
        } else {
          draw()
        }
      } catch (e) {
        done('')
      }
    }
    video.onseeked = draw
    video.onerror = () => done('')
  })
}

/** 探测单个视频时长（仅读取元数据） */
function probeDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = url
    const done = (dur) => {
      URL.revokeObjectURL(url)
      resolve(dur)
    }
    video.onloadedmetadata = () => done(video.duration || 0)
    video.onerror = () => done(0)
  })
}

/** 添加文件（多个），按文件名+大小去重 */
async function addFiles(files) {
  const list = Array.from(files).filter((f) => f.type.startsWith('video/'))
  if (!list.length) {
    message.warning('请选择视频文件')
    return
  }
  let added = 0
  for (const file of list) {
    const dup = videos.value.some((v) => v.file.name === file.name && v.file.size === file.size)
    if (dup) continue
    const [duration, thumbnail] = await Promise.all([probeDuration(file), captureThumbnail(file)])
    const id = nextId++
    videos.value.push({ id, file, duration, thumbnail })
    if (!activeId.value) activeId.value = id
    added++
  }
  if (added) message.success(`已添加 ${added} 个视频`)
  else message.warning('所选视频已在列表中')
}

/** UploadZone 回调（multiple 模式回调 File[]） */
function handleSelect(files) {
  addFiles(files)
}

/** "继续添加视频"：弹出多选文件框 */
function showPicker() {
  fileInput.value?.click()
}

function onHiddenChange(e) {
  addFiles(e.target.files)
  e.target.value = ''
}

function selectVideo(id) {
  activeId.value = id
}

function removeVideo(id) {
  const idx = videos.value.findIndex((v) => v.id === id)
  if (idx === -1) return
  videos.value.splice(idx, 1)
  if (activeId.value === id) {
    const next = videos.value[idx] || videos.value[idx - 1] || videos.value[0]
    activeId.value = next ? next.id : null
  }
}

function clearAll() {
  videos.value = []
  activeId.value = null
}

function swap(i, j) {
  const arr = [...videos.value]
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  videos.value = arr
}

function moveLeft(index) {
  if (index > 0) swap(index, index - 1)
}

function moveRight(index) {
  if (index < videos.value.length - 1) swap(index, index + 1)
}

// ---------- 拖拽排序 ----------
const dragIndex = ref(null)

function onDragStart(index) {
  dragIndex.value = index
}

function onDragOver(e) {
  e.preventDefault()
}

function onDrop(index) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from === null || from === index) return
  const arr = [...videos.value]
  const [item] = arr.splice(from, 1)
  arr.splice(index, 0, item)
  videos.value = arr
}

function onDragEnd() {
  dragIndex.value = null
}

// ---------- 缩略图条滚动控制 ----------
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

function checkScroll() {
  const el = stripEl.value
  if (!el) {
    canScrollLeft.value = false
    canScrollRight.value = false
    return
  }
  canScrollLeft.value = el.scrollLeft > 0
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function scrollStrip(dir) {
  const el = stripEl.value
  if (!el) return
  el.scrollBy({ left: dir * 220, behavior: 'smooth' })
}

watch(
  () => videos.value.length,
  () => {
    requestAnimationFrame(checkScroll)
  }
)

// ---------- 合并导出 ----------
let offProgress = null
let offDone = null
let offError = null

onMounted(() => {
  window.api?.getDesktopPath?.().then((p) => {
    if (p) outputDir.value = p
  })

  offProgress = window.api?.onMergeProgress((data) => {
    mergeProgress.value = data.percent
    mergeMessage.value = data.message
  })
  offDone = window.api?.onMergeDone((data) => {
    isMerging.value = false
    mergeStatus.value = 'done'
    mergeMessage.value = `已导出：${data.outputPath}`
  })
  offError = window.api?.onMergeError((data) => {
    isMerging.value = false
    mergeStatus.value = 'error'
    mergeMessage.value = `合并失败：${data.message}`
  })

  requestAnimationFrame(checkScroll)
  stripEl.value?.addEventListener('scroll', checkScroll, { passive: true })
})

onUnmounted(() => {
  offProgress?.()
  offDone?.()
  offError?.()
  stripEl.value?.removeEventListener('scroll', checkScroll)
  if (activeUrl.value) URL.revokeObjectURL(activeUrl.value)
})

const canMerge = computed(
  () => videos.value.length >= 2 && !isMerging.value && !!outputDir.value
)

const progressColor = computed(() => {
  if (mergeStatus.value === 'error') return '#dc2626'
  if (mergeStatus.value === 'done') return '#22c55e'
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

async function applyMerge() {
  if (videos.value.length < 2) {
    message.warning('请至少选择 2 个视频')
    return
  }
  if (!outputDir.value) {
    message.warning('请先选择保存目录')
    return
  }

  const inputPaths = videos.value.map((v) => window.api?.getPathForFile(v.file))
  if (inputPaths.some((p) => !p)) {
    mergeStatus.value = 'error'
    mergeMessage.value = '无法获取视频文件路径'
    return
  }

  mergeStatus.value = 'running'
  mergeProgress.value = 0
  mergeMessage.value = '准备合并...'
  isMerging.value = true

  const res = await window.api?.mergeVideos({ inputPaths, outputDir: outputDir.value })

  if (res && res.canceled) {
    isMerging.value = false
    mergeStatus.value = 'idle'
    mergeMessage.value = ''
  }
}
</script>

<template>
  <div class="page">
    <!-- 未添加视频：上传区 -->
    <div v-if="!videos.length" class="upload-wrap">
      <UploadZone
        multiple
        button-text="选择视频"
        :tips="['点击或拖拽多个视频到此', '至少选择 2 个视频，按列表顺序合并']"
        accept="video/*"
        @select="handleSelect"
      />
    </div>

    <!-- 已添加视频 -->
    <div v-else class="merge-view">
      <div class="split">
        <!-- 左列：主预览 + 缩略图条 -->
        <div class="split-left">
          <div class="preview-wrap">
            <video v-if="activeUrl" :src="activeUrl" controls class="preview-video"></video>
            <div v-else class="preview-empty">选择一个视频进行预览</div>
          </div>

          <div class="thumb-bar">
            <button
              class="thumb-arrow left"
              type="button"
              :disabled="!canScrollLeft"
              @click="scrollStrip(-1)"
            >
              <svg
                class="arrow-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div ref="stripEl" class="thumb-strip">
              <div class="thumb-list">
                <div
                  v-for="(item, index) in videos"
                  :key="item.id"
                  class="thumb-card"
                  :class="{
                    active: item.id === activeId,
                    'drag-over': dragIndex !== null && dragIndex !== index
                  }"
                  :title="`${item.file.name} · ${formatSize(item.file.size)} · ${formatTime(item.duration)} · 拖拽可调整顺序`"
                  draggable="true"
                  @click="selectVideo(item.id)"
                  @dragstart="onDragStart(index)"
                  @dragover.prevent
                  @drop="onDrop(index)"
                  @dragend="onDragEnd"
                >
                  <img
                    v-if="item.thumbnail"
                    :src="item.thumbnail"
                    class="thumb-img"
                    draggable="false"
                  />
                  <div v-else class="thumb-placeholder">
                    <svg
                      class="film-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <rect x="2" y="2" width="20" height="20" rx="2" />
                      <line x1="7" y1="2" x2="7" y2="22" />
                      <line x1="17" y1="2" x2="17" y2="22" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                    </svg>
                  </div>
                  <span class="thumb-index">{{ index + 1 }}</span>
                  <div v-if="item.id === activeId" class="thumb-check">
                    <svg
                      class="check-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div v-if="videos.length > 1" class="thumb-sort" @click.stop>
                    <button
                      type="button"
                      class="sort-btn"
                      title="前移"
                      :disabled="index === 0 || isMerging"
                      @click="moveLeft(index)"
                    >
                      <svg
                        class="sort-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="sort-btn"
                      title="后移"
                      :disabled="index === videos.length - 1 || isMerging"
                      @click="moveRight(index)"
                    >
                      <svg
                        class="sort-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                  <button
                    type="button"
                    class="thumb-delete"
                    title="删除"
                    :disabled="isMerging"
                    @click.stop="removeVideo(item.id)"
                  >
                    <svg
                      class="delete-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <div class="thumb-card add" :title="'继续添加视频'" @click="showPicker">
                  <svg
                    class="add-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
              </div>
            </div>

            <button
              class="thumb-arrow right"
              type="button"
              :disabled="!canScrollRight"
              @click="scrollStrip(1)"
            >
              <svg
                class="arrow-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button
              class="thumb-arrow clear"
              type="button"
              title="清空列表"
              :disabled="isMerging"
              @click="clearAll"
            >
              <svg
                class="arrow-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 右栏：输出设置 + 合并 -->
        <div class="split-right">
          <div class="merge-panel right-panel">
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
                :disabled="isMerging"
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

            <div class="merge-info">
              <div class="info-row">
                <span class="info-label">参与合并</span>
                <span class="info-value">{{ videos.length }} 个视频</span>
              </div>
              <div class="info-row">
                <span class="info-label">预计总时长</span>
                <span class="info-value">{{ totalDurationText }}</span>
              </div>
              <p class="merge-tip">不同分辨率/帧率的视频会自动统一规格后拼接</p>
            </div>

            <div class="apply-bar">
              <n-button type="primary" size="large" block :disabled="!canMerge" @click="applyMerge">
                {{ isMerging ? '合并中...' : '开始合并' }}
              </n-button>
            </div>

            <div
              v-if="mergeStatus !== 'idle'"
              class="merge-progress"
              :class="'merge-' + mergeStatus"
            >
              <n-progress
                type="line"
                :percentage="mergeProgress"
                :height="8"
                :show-indicator="false"
                :color="progressColor"
                rail-color="#e2e8f0"
              />
              <p class="progress-message">{{ mergeMessage }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      multiple
      accept="video/*"
      hidden
      @change="onHiddenChange"
    />
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

/* ---------- 合并视图 ---------- */
.merge-view {
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

/* ---------- 主预览区 ---------- */
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

.preview-empty {
  color: #94a3b8;
  font-size: 14px;
}

/* ---------- 缩略图条 ---------- */
.thumb-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background-color: #ffffff;
  border-top: 1px solid #e2e8f0;
}

.thumb-arrow {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #e2e8f0;
  border-radius: 50%;
  background-color: #ffffff;
  color: #475569;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s,
    color 0.15s;
}

.thumb-arrow:hover:not(:disabled) {
  border-color: #2563eb;
  color: #2563eb;
  background-color: #eff6ff;
}

.thumb-arrow:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.arrow-icon {
  width: 16px;
  height: 16px;
}

.thumb-strip {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scroll-behavior: smooth;
  scrollbar-width: thin;
}

.thumb-strip::-webkit-scrollbar {
  height: 6px;
}

.thumb-strip::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 3px;
}

.thumb-list {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
}

.thumb-card {
  position: relative;
  flex-shrink: 0;
  width: 100px;
  height: 100px;
  border: 2px solid transparent;
  border-radius: 8px;
  background-color: #f1f5f9;
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color 0.15s,
    transform 0.15s,
    box-shadow 0.15s;
}

.thumb-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.1);
}

.thumb-card.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

/* 拖拽经过的卡片：高亮提示落点 */
.thumb-card.drag-over {
  border-color: #2563eb;
  transform: translateY(-2px);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.25);
}

.thumb-card.add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed #cbd5e1;
  background-color: #ffffff;
  color: #94a3b8;
}

.thumb-card.add:hover {
  border-color: #2563eb;
  color: #2563eb;
  background-color: #eff6ff;
}

.thumb-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #94a3b8;
}

.film-icon {
  width: 26px;
  height: 26px;
}

.add-icon {
  width: 26px;
  height: 26px;
}

.thumb-index {
  position: absolute;
  left: 6px;
  bottom: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background-color: rgba(15, 23, 42, 0.7);
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
}

.thumb-check {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: #2563eb;
  color: #ffffff;
}

.check-icon {
  width: 10px;
  height: 10px;
}

.thumb-delete {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background-color: rgba(220, 38, 38, 0.85);
  color: #ffffff;
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.15s;
}

.thumb-card:hover .thumb-delete {
  opacity: 1;
}

.thumb-delete:hover {
  background-color: #dc2626;
}

.thumb-delete:disabled {
  cursor: not-allowed;
}

/* 选中状态不显示删除按钮，避免与勾选重叠；非选中时删除按钮在右 */
.thumb-card.active .thumb-delete {
  display: none;
}

/* 排序按钮：悬停卡片时在右下角显示，可调整合并顺序 */
.thumb-sort {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.thumb-card:hover .thumb-sort {
  opacity: 1;
}

.sort-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background-color: rgba(15, 23, 42, 0.7);
  color: #ffffff;
  cursor: pointer;
  transition: background-color 0.15s;
}

.sort-btn:hover:not(:disabled) {
  background-color: #2563eb;
}

.sort-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sort-icon {
  width: 10px;
  height: 10px;
}

.thumb-arrow.clear:hover:not(:disabled) {
  border-color: #dc2626;
  color: #dc2626;
  background-color: #fef2f2;
}

/* ---------- 右栏设置面板 ---------- */
.merge-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 20px;
  border: none;
  border-radius: 0;
  background-color: #ffffff;
}

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

.merge-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
  padding: 14px;
  border-radius: 10px;
  background-color: #f8fafc;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.info-label {
  color: #64748b;
}

.info-value {
  font-weight: 600;
  color: #334155;
}

.merge-tip {
  margin: 4px 0 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
}

.apply-bar {
  margin-top: 20px;
}

.merge-progress {
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

.merge-error .progress-message {
  color: #dc2626;
}

.merge-done .progress-message {
  color: #16a34a;
}
</style>
