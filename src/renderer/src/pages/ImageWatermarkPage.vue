<script setup>
import { computed, nextTick, ref, onMounted, onUnmounted } from 'vue'
import UploadZone from '../components/UploadZone.vue'
import { message, dialog } from '../utils/naive'

const imageFile = ref(null)
const imageUrl = ref('')
const wrapEl = ref(null)
const stageEl = ref(null)
// 图片在 zoom=1 时按容器 contain 缩放后的基础尺寸
const stageSize = ref({ w: 0, h: 0 })
const imgWidth = ref(0) // 图片原始宽度（像素，由主进程探测）
const imgHeight = ref(0) // 图片原始高度（像素）
const zoom = ref(1)
const minZoom = 0.5
const maxZoom = 4
const zoomStep = 0.1

// 水印区域列表：{ id, name, displayRect, sourceRect }
const regions = ref([])
const activeId = ref(null)
const isAddingNew = ref(false)
const tempRect = ref(null)
let nextId = 1

// 处理方式：delogo 智能填充 / blur 区域模糊 / solid 纯色覆盖
const method = ref('delogo')
const methodOptions = [
  { value: 'delogo', label: '智能填充（背景简单时最自然）' },
  { value: 'blur', label: '区域模糊（背景复杂时用）' },
  { value: 'solid', label: '纯色覆盖（压在纯色背景上）' }
]
// boxblur 半径有效范围 1-15，超出 ffmpeg 会报错
const blurStrength = ref(10)
const solidColor = ref('#ffffff')

const fileSizeText = computed(() => {
  if (!imageFile.value) return ''
  const size = imageFile.value.size
  if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + ' MB'
  return (size / 1024).toFixed(2) + ' KB'
})

// 输出格式跟随原图，不支持的格式回退为 png
const outputExt = computed(() => {
  const m = (imageFile.value?.name || '').toLowerCase().match(/\.(png|jpg|jpeg|webp|bmp)$/)
  if (!m) return 'png'
  return m[1] === 'jpeg' ? 'jpg' : m[1]
})

async function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    message.warning('请选择图片文件')
    return
  }
  const inputPath = window.api?.getPathForFile?.(file)
  if (!inputPath) {
    message.error('无法获取图片路径')
    return
  }
  // 用主进程探测的尺寸做坐标基准，与 ffmpeg 处理时看到的像素完全一致
  try {
    const meta = await window.api.probeImage(inputPath)
    imgWidth.value = meta.width
    imgHeight.value = meta.height
  } catch {
    message.error('无法解析该图片，请换一张试试')
    return
  }
  imageFile.value = file
  imageUrl.value = URL.createObjectURL(file)
  // 等预览区渲染出来再按容器计算显示尺寸
  await nextTick()
  updateStageSize()
}

function resetImage() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = ''
  imageFile.value = null
  imgWidth.value = 0
  imgHeight.value = 0
  regions.value = []
  activeId.value = null
  isAddingNew.value = false
  tempRect.value = null
  nextId = 1
  zoom.value = 1
  stageSize.value = { w: 0, h: 0 }
  wmStatus.value = 'idle'
  wmProgress.value = 0
  wmMessage.value = ''
}

function confirmResetImage() {
  dialog.warning({
    title: '重新选择图片',
    content: '确定重新选择图片吗？当前框选的水印区域将被清空。',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: resetImage
  })
}

// ---------- 显示尺寸与缩放 ----------
function updateStageSize() {
  const wrap = wrapEl.value
  if (!wrap || !imgWidth.value || !imgHeight.value) return
  const rect = wrap.getBoundingClientRect()
  const scale = Math.min(rect.width / imgWidth.value, rect.height / imgHeight.value)
  const oldW = stageSize.value.w
  const oldH = stageSize.value.h
  const newW = imgWidth.value * scale
  const newH = imgHeight.value * scale
  stageSize.value = { w: newW, h: newH }
  // 容器尺寸变化后，已框选区域等比跟随，避免错位
  if (oldW > 0 && oldH > 0 && (oldW !== newW || oldH !== newH)) {
    const rx = newW / oldW
    const ry = newH / oldH
    regions.value.forEach((r) => {
      const d = r.displayRect
      r.displayRect = { x: d.x * rx, y: d.y * ry, w: d.w * rx, h: d.h * ry }
      r.sourceRect = toSourceRect(r.displayRect)
    })
  }
}

/** 当前显示像素与图片原始像素的比例 */
const currentScale = computed(() => {
  if (!stageSize.value.w || !imgWidth.value || !zoom.value) return 0
  return (stageSize.value.w * zoom.value) / imgWidth.value
})

/** 把画面坐标转换为图片原始像素坐标 */
function toSourceRect(displayRect) {
  if (!displayRect || !imgWidth.value || !imgHeight.value) return null
  const scale = currentScale.value
  if (!scale) return null
  const x = Math.round(Math.max(0, displayRect.x / scale))
  const y = Math.round(Math.max(0, displayRect.y / scale))
  const w = Math.round(Math.min(displayRect.w / scale, imgWidth.value - x))
  const h = Math.round(Math.min(displayRect.h / scale, imgHeight.value - y))
  if (w < 1 || h < 1) return null
  return { x, y, w, h }
}

const zoomPercent = computed(() => Math.round(zoom.value * 100) + '%')

function setZoom(newZoom) {
  const ratio = newZoom / zoom.value
  zoom.value = newZoom
  regions.value.forEach((r) => {
    const d = r.displayRect
    r.displayRect = { x: d.x * ratio, y: d.y * ratio, w: d.w * ratio, h: d.h * ratio }
    r.sourceRect = toSourceRect(r.displayRect)
  })
}

function zoomIn() {
  setZoom(Math.min(maxZoom, zoom.value + zoomStep))
}

function zoomOut() {
  setZoom(Math.max(minZoom, zoom.value - zoomStep))
}

function resetZoom() {
  setZoom(1)
}

// ---------- 多选区管理 ----------
function addRegion() {
  isAddingNew.value = true
  activeId.value = null
  tempRect.value = null
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

function clearAllRegions() {
  regions.value = []
  activeId.value = null
  isAddingNew.value = false
  nextId = 1
}

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

function clampRect(x, y, w, h, maxX, maxY) {
  if (w < 10 || h < 10) return { x, y, w, h }
  x = Math.min(Math.max(x, 0), Math.max(0, maxX - w))
  y = Math.min(Math.max(y, 0), Math.max(0, maxY - h))
  w = Math.min(w, maxX - x)
  h = Math.min(h, maxY - y)
  return { x, y, w, h }
}

let drag = null // { mode, startX, startY, id?, origin? }

function onOverlayMouseDown(e) {
  const stage = stageEl.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top
  if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) return

  if (isAddingNew.value) {
    drag = { mode: 'create', startX: e.clientX, startY: e.clientY }
    tempRect.value = { x: sx, y: sy, w: 0, h: 0 }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return
  }

  const hit = [...regions.value].reverse().find((r) => isInsideRect(sx, sy, r.displayRect))
  if (!hit) return
  activeId.value = hit.id
  drag = {
    mode: isOnHandle(sx, sy, hit.displayRect) ? 'resize' : 'move',
    id: hit.id,
    startX: e.clientX,
    startY: e.clientY,
    origin: { ...hit.displayRect }
  }
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e) {
  if (!drag) return
  const stage = stageEl.value
  if (!stage) return
  const dx = e.clientX - drag.startX
  const dy = e.clientY - drag.startY
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
    tempRect.value = clampRect(x, y, w, h, maxX, maxY)
    return
  }

  const region = regions.value.find((r) => r.id === drag.id)
  if (!region) return
  const origin = drag.origin
  if (drag.mode === 'move') {
    region.displayRect = {
      ...origin,
      x: Math.min(Math.max(origin.x + dx, 0), Math.max(0, maxX - origin.w)),
      y: Math.min(Math.max(origin.y + dy, 0), Math.max(0, maxY - origin.h))
    }
  } else {
    region.displayRect = {
      ...origin,
      w: Math.min(Math.max(origin.w + dx, 10), maxX - origin.x),
      h: Math.min(Math.max(origin.h + dy, 10), maxY - origin.y)
    }
  }
  region.sourceRect = toSourceRect(region.displayRect)
}

function onMouseUp() {
  if (drag?.mode === 'create' && tempRect.value) {
    const { x, y, w, h } = tempRect.value
    if (w >= 10 && h >= 10) {
      const displayRect = { x, y, w, h }
      const sourceRect = toSourceRect(displayRect)
      if (sourceRect) {
        const id = nextId++
        regions.value.push({ id, name: `区域${id}`, displayRect, sourceRect })
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

const stageStyle = computed(() => ({
  width: stageSize.value.w * zoom.value + 'px',
  height: stageSize.value.h * zoom.value + 'px'
}))

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
let resizeTimer = null
let onWindowResize = null

function scheduleUpdateStageSize() {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(updateStageSize, 60)
}

onMounted(() => {
  window.api?.getDesktopPath?.().then((p) => {
    if (p) outputDir.value = p
  })

  offProgress = window.api?.onImageWatermarkProgress((data) => {
    wmProgress.value = data.percent
    wmMessage.value = data.message
  })
  offDone = window.api?.onImageWatermarkDone((data) => {
    isRemoving.value = false
    wmStatus.value = 'done'
    wmProgress.value = 100
    wmMessage.value = `已导出：${data.outputPath}`
  })
  offError = window.api?.onImageWatermarkError((data) => {
    isRemoving.value = false
    wmStatus.value = 'error'
    wmMessage.value = `去水印失败：${data.message}`
  })

  if (wrapEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => scheduleUpdateStageSize())
    resizeObserver.observe(wrapEl.value)
  }
  onWindowResize = () => scheduleUpdateStageSize()
  window.addEventListener('resize', onWindowResize)
})

onUnmounted(() => {
  offProgress?.()
  offDone?.()
  offError?.()
  resizeObserver?.disconnect()
  if (resizeTimer) clearTimeout(resizeTimer)
  if (onWindowResize) window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})

const canRemove = computed(
  () => !!imageFile.value && regions.value.length > 0 && !isRemoving.value && !!outputDir.value
)

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

async function applyRemove() {
  if (!imageFile.value || regions.value.length === 0) return
  if (!outputDir.value) {
    message.warning('请先选择保存目录')
    return
  }

  const inputPath = window.api?.getPathForFile(imageFile.value)
  if (!inputPath) {
    wmStatus.value = 'error'
    wmMessage.value = '无法获取图片文件路径'
    return
  }

  wmStatus.value = 'running'
  wmProgress.value = 0
  wmMessage.value = '准备去水印...'
  isRemoving.value = true

  try {
    const res = await window.api?.removeImageWatermark({
      inputPath,
      regions: regions.value.map((r) => ({ ...r.sourceRect })),
      imageWidth: imgWidth.value,
      imageHeight: imgHeight.value,
      method: method.value,
      blurStrength: blurStrength.value,
      solidColor: solidColor.value,
      outputExt: outputExt.value,
      outputDir: outputDir.value
    })

    // 用户取消了保存对话框：恢复空闲态
    if (res && res.canceled) {
      isRemoving.value = false
      wmStatus.value = 'idle'
      wmMessage.value = ''
    }
  } catch (e) {
    // 主进程直接抛错（如参数校验失败）时兜底，避免按钮一直卡在处理中
    isRemoving.value = false
    wmStatus.value = 'error'
    wmMessage.value = `去水印失败：${e?.message || e}`
  }
}
</script>

<template>
  <div class="page">
    <!-- 未选择图片：通用上传/拖拽组件 -->
    <div v-if="!imageFile" class="upload-wrap">
      <UploadZone
        button-text="上传图片"
        :tips="['拖拽图片到此或点击上传', '支持 PNG、JPG、WebP 等常见图片格式']"
        accept="image/*"
        @select="handleFile"
      />
    </div>

    <!-- 已选择图片 -->
    <div v-else class="image-preview">
      <div class="split">
        <!-- 左列：图片预览 + 框选水印区域 -->
        <div class="split-left">
          <div ref="wrapEl" class="image-wrap">
            <div ref="stageEl" class="image-stage" :style="stageStyle">
              <img :src="imageUrl" class="image-el" alt="待处理图片" draggable="false" />

              <!-- 框选层：精确覆盖图片区域，显示/编辑所有选区 -->
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

                <div v-if="isAddingNew" class="wm-hint">在图片上拖拽框住水印</div>
              </div>
            </div>
          </div>

          <!-- 缩放工具条：图片较大时放大后再框选更精准 -->
          <div class="zoom-bar">
            <button
              type="button"
              class="zoom-btn"
              :disabled="zoom <= minZoom"
              aria-label="缩小"
              @click="zoomOut"
            >
              <svg
                class="zoom-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <span class="zoom-value" @click="resetZoom">{{ zoomPercent }}</span>
            <button
              type="button"
              class="zoom-btn"
              :disabled="zoom >= maxZoom"
              aria-label="放大"
              @click="zoomIn"
            >
              <svg
                class="zoom-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <span class="zoom-hint">点击百分比复位</span>
          </div>

          <div class="image-info">
            <span class="file-name">{{ imageFile.name }}</span>
            <span class="file-size">{{ fileSizeText }}</span>
            <span v-if="imgWidth" class="file-size">{{ imgWidth }} × {{ imgHeight }}</span>
          </div>

          <div class="crop-panel">
            <div class="crop-header">
              <span>右侧「新增去水印区域」，在图片上拖拽框住水印</span>
            </div>
            <div class="crop-actions">
              <n-button size="medium" @click="confirmResetImage">重新选择图片</n-button>
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

        <!-- 右列：选区列表 + 处理方式 + 导出 -->
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
                  <span class="region-coord">
                    {{ r.sourceRect.x }}, {{ r.sourceRect.y }} · {{ r.sourceRect.w }}×{{
                      r.sourceRect.h
                    }}
                  </span>
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

            <div class="method-section">
              <span class="section-label">处理方式</span>
              <n-radio-group v-model:value="method" class="method-group">
                <n-radio value="delogo">智能填充</n-radio>
                <n-radio value="blur">区域模糊</n-radio>
                <n-radio value="solid">纯色覆盖</n-radio>
              </n-radio-group>
              <p class="method-tip">{{ methodOptions.find((m) => m.value === method)?.label }}</p>

              <div v-if="method === 'blur'" class="param-row">
                <span class="param-label">模糊强度</span>
                <n-slider v-model:value="blurStrength" :min="1" :max="15" :step="1" />
                <span class="param-value">{{ blurStrength }}</span>
              </div>

              <div v-if="method === 'solid'" class="param-row">
                <span class="param-label">填充颜色</span>
                <n-color-picker v-model:value="solidColor" size="small" :show-alpha="false" />
              </div>
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
                @click="applyRemove"
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

.upload-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.image-preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

/* 左右分栏：右栏绝对定位贴住 .content 的上下左右边缘 */
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
  margin-right: 340px;
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

.image-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background-color: #f1f5f9;
  background-image:
    linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
    linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
    linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
}

.image-stage {
  position: relative;
  flex-shrink: 0;
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.15);
}

.image-el {
  display: block;
  width: 100%;
  height: 100%;
  /* 关闭浏览器按 EXIF 自动旋转，与 ffmpeg -noautorotate 的像素方向保持一致 */
  image-orientation: none;
  user-select: none;
}

/* 框选层：铺满图片舞台 */
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

/* ---------- 缩放工具条 ---------- */
.zoom-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
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

.zoom-hint {
  font-size: 12px;
  color: #94a3b8;
}

.image-info {
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

/* ---------- 通用面板（与其他页面保持一致） ---------- */
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
  font-weight: 600;
  color: #334155;
}

.crop-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

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

.region-coord {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  padding: 24px 0 12px;
}

/* ---------- 处理方式 ---------- */
.method-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
}

.section-label {
  font-weight: 600;
  font-size: 14px;
  color: #334155;
}

.method-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.method-tip {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
}

.param-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.param-label {
  flex-shrink: 0;
  font-size: 13px;
  color: #475569;
}

.param-value {
  flex-shrink: 0;
  min-width: 24px;
  text-align: right;
  font-size: 12px;
  color: #334155;
  font-variant-numeric: tabular-nums;
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
