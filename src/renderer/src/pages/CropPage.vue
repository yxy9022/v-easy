<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import UploadZone from '../components/UploadZone.vue'
import { message, dialog } from '../utils/naive'

const videoFile = ref(null)
const videoUrl = ref('')
const videoEl = ref(null)

const duration = ref(0) // 视频总时长（秒）
const currentTime = ref(0) // 当前播放位置（秒）
const startTime = ref(0) // 裁剪开始时间（秒）
const endTime = ref(0) // 裁剪结束时间（秒）
const previewEnd = ref(0) // 预览选中片段时的结束时间，0 表示未在预览
const clips = ref([]) // 已添加的多个裁剪片段 [{ id, start, end }]
const mode = ref('keep') // 裁剪模式：'keep' 保留所选片段 | 'remove' 删除所选片段
let clipId = 0

const modeTip = computed(() =>
  mode.value === 'keep'
    ? '将保留列表中选中的片段，其余部分会被裁剪掉'
    : '将删除列表中选中的片段，其余部分会合并保留'
)

const clipsTitle = computed(() =>
  mode.value === 'keep'
    ? `将保留 ${clips.value.length} 个片段`
    : `将删除 ${clips.value.length} 个片段`
)

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

/** 切换裁剪模式：'keep' 保留所选片段 ⇄ 'remove' 删除所选片段 */
function toggleMode() {
  mode.value = mode.value === 'keep' ? 'remove' : 'keep'
}

/** 模式开关轨道颜色：删除模式橙色，保留模式蓝色 */
function modeRailStyle({ checked }) {
  return { background: checked ? '#f97316' : '#2563eb' }
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

/** 重新选择视频前弹出确认框 */
function confirmResetVideo() {
  dialog.warning({
    title: '重新选择视频',
    content: '确定重新选择视频吗？当前已添加的裁剪片段将被清空。',
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
  // 预览选中片段：播放到结束点自动暂停
  if (previewEnd.value && videoEl.value.currentTime >= previewEnd.value) {
    videoEl.value.pause()
    previewEnd.value = 0
  }
}

function onPause() {
  previewEnd.value = 0
}

/** 将视频暂停并跳转到指定时间，便于直观查看该时刻画面 */
function seekTo(time) {
  if (videoEl.value && isFinite(time)) {
    videoEl.value.pause()
    videoEl.value.currentTime = time
  }
}

/** 预览指定片段：从 clip.start 播放到 clip.end 自动暂停 */
function previewClipAt(clip) {
  if (!videoEl.value || !duration.value) return
  if (clip.end - clip.start < 0.1) return
  previewEnd.value = clip.end
  videoEl.value.currentTime = clip.start
  videoEl.value.play()
}

// ---------- 裁剪范围 ----------
function onStartInput(e) {
  startTime.value = Math.min(Number(e.target.value), endTime.value - 0.1)
  // 同步 DOM，避免叠加的 range input 显示错位
  e.target.value = startTime.value
  seekTo(startTime.value)
}

function onEndInput(e) {
  endTime.value = Math.max(Number(e.target.value), startTime.value + 0.1)
  // 同步 DOM，避免叠加的 range input 显示错位
  e.target.value = endTime.value
  seekTo(endTime.value)
}

// ---------- 多片段管理 ----------

/** 区间合并：对片段列表做并集，重叠/相邻区间合并，返回按开始时间有序的新列表 */
function mergeClips(list) {
  const sorted = [...list].sort((a, b) => a.start - b.start)
  const result = []
  for (const clip of sorted) {
    const last = result[result.length - 1]
    if (last && clip.start <= last.end) {
      // 重叠或相邻：扩展上一个区间
      if (clip.end > last.end) last.end = clip.end
    } else {
      result.push({ ...clip })
    }
  }
  return result
}

function addClip() {
  if (endTime.value - startTime.value < 0.1) {
    message.warning('裁剪范围过短，请先调整开始/结束时间')
    return
  }
  const before = clips.value.length
  clips.value = mergeClips([
    ...clips.value,
    { id: ++clipId, start: startTime.value, end: endTime.value }
  ])
  if (clips.value.length < before + 1) {
    message.info('该片段与已有片段重叠（或相邻），已自动合并')
  }
}

function removeClip(id) {
  clips.value = clips.value.filter((c) => c.id !== id)
}

function clearClips() {
  clips.value = []
}

/** 片段在轨道上的高亮样式（相对总时长百分比） */
function clipStyle(clip) {
  if (!duration.value) return { left: '0%', width: '0%' }
  const left = (clip.start / duration.value) * 100
  const width = ((clip.end - clip.start) / duration.value) * 100
  return { left: left + '%', width: width + '%' }
}

// ---------- 裁剪导出（ffmpeg） ----------
const isCropping = ref(false)
const cropProgress = ref(0)
const cropStatus = ref('idle') // idle | running | done | error
const cropMessage = ref('')
const outputDir = ref('') // 裁剪输出目录

let offProgress = null
let offDone = null
let offError = null

onMounted(() => {
  // 默认保存目录为系统桌面
  window.api?.getDesktopPath?.().then((p) => {
    if (p) outputDir.value = p
  })

  offProgress = window.api?.onCropProgress((data) => {
    cropProgress.value = data.percent
    cropMessage.value = data.message
  })
  offDone = window.api?.onCropDone((data) => {
    isCropping.value = false
    cropStatus.value = 'done'
    cropMessage.value = `已导出：${data.outputPath}`
  })
  offError = window.api?.onCropError((data) => {
    isCropping.value = false
    cropStatus.value = 'error'
    cropMessage.value = `裁剪失败：${data.message}`
  })
})

onUnmounted(() => {
  offProgress?.()
  offDone?.()
  offError?.()
})

const canCrop = computed(() => clips.value.length > 0 && !isCropping.value && !!outputDir.value)

/** 进度条颜色：按裁剪状态切换 */
const progressColor = computed(() => {
  if (cropStatus.value === 'error') return '#dc2626'
  if (cropStatus.value === 'done') return '#22c55e'
  return '#2563eb'
})

/** 选择裁剪输出目录 */
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

async function applyCrop() {
  if (!videoFile.value || !clips.value.length) return

  if (!outputDir.value) {
    message.warning('请先选择保存目录')
    return
  }

  // 删除模式下所选片段覆盖全片时，无剩余内容可导出
  const totalClipped = clips.value.reduce((sum, c) => sum + (c.end - c.start), 0)
  if (mode.value === 'remove' && duration.value - totalClipped < 0.1) {
    message.warning('所选片段已覆盖整个视频，没有可保留的内容')
    return
  }

  const inputPath = window.api?.getPathForFile(videoFile.value)
  if (!inputPath) {
    cropStatus.value = 'error'
    cropMessage.value = '无法获取视频文件路径'
    return
  }

  cropStatus.value = 'running'
  cropProgress.value = 0
  cropMessage.value = '准备裁剪...'
  isCropping.value = true

  const res = await window.api?.cropVideo({
    inputPath,
    mode: mode.value,
    // 转成普通对象数组（Vue 响应式 Proxy 无法被 IPC 克隆）
    clips: clips.value.map((c) => ({ start: c.start, end: c.end })),
    duration: duration.value,
    outputDir: outputDir.value
  })

  // 用户在保存对话框取消
  if (res && res.canceled) {
    isCropping.value = false
    cropStatus.value = 'idle'
    cropMessage.value = ''
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
        <!-- 左列：视频预览 + 裁剪片段选择 -->
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
              <span>拖动下面的滑块，选取剪裁片段</span>
            </div>

            <!-- 双滑块时间范围选择 -->
            <div class="range-track">
              <div class="range-bg"></div>
              <!-- 已添加片段的高亮 -->
              <div
                v-for="clip in clips"
                :key="clip.id"
                class="range-clip"
                :style="clipStyle(clip)"
              ></div>
              <!-- 当前滑块选中的范围 -->
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

            <div class="crop-actions">
              <n-button size="medium" @click="confirmResetVideo">重新选择视频</n-button>
              <n-button
                size="medium"
                type="primary"
                secondary
                :disabled="isCropping"
                @click="addClip"
              >
                添加为裁剪片段
              </n-button>
            </div>
          </div>
        </div>

        <!-- 右列：已添加片段列表 + 裁剪应用 -->
        <div v-if="duration" class="split-right">
          <div class="crop-panel right-panel">
            <!-- 裁剪模式 switch -->
            <div class="mode-bar">
              <span class="mode-label">裁剪模式</span>
              <div class="mode-switch">
                <span class="mode-text" :class="{ active: mode === 'keep' }">保留所选片段</span>
                <n-switch
                  size="medium"
                  :value="mode === 'remove'"
                  :rail-style="modeRailStyle"
                  @update:value="toggleMode"
                />
                <span class="mode-text" :class="{ active: mode === 'remove' }">删除所选片段</span>
              </div>
            </div>
            <p class="mode-tip">{{ modeTip }}</p>

            <div class="clips-panel">
              <div class="clips-header">
                <span class="clips-title">{{ clipsTitle }}</span>
                <div class="clips-actions">
                  <n-button size="tiny" @click="clearClips">清空</n-button>
                </div>
              </div>
              <ul v-if="clips.length" class="clip-list">
                <li v-for="(clip, index) in clips" :key="clip.id" class="clip-item">
                  <span class="clip-index">{{ index + 1 }}</span>
                  <span class="clip-time">开始 {{ formatTime(clip.start) }}</span>
                  <span class="clip-arrow">→</span>
                  <span class="clip-time">结束 {{ formatTime(clip.end) }}</span>
                  <span class="clip-footer">
                    <span class="clip-duration">时长 {{ formatTime(clip.end - clip.start) }}</span>
                    <span class="clip-actions">
                      <n-button size="tiny" :disabled="isCropping" @click="previewClipAt(clip)">
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
                description="暂无裁剪片段，先在左侧框选并添加"
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
                :disabled="isCropping"
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
              <n-button type="primary" size="large" block :disabled="!canCrop" @click="applyCrop">
                {{ isCropping ? '裁剪中...' : '开始裁剪' }}
              </n-button>
            </div>

            <!-- 裁剪进度 -->
            <div v-if="cropStatus !== 'idle'" class="crop-progress" :class="'crop-' + cropStatus">
              <n-progress
                type="line"
                :percentage="cropProgress"
                :height="8"
                :show-indicator="false"
                :color="progressColor"
                rail-color="#e2e8f0"
              />
              <p class="progress-message">{{ cropMessage }}</p>
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
  /* 左右 -28px 抵消 .content 左右 padding(28px)，让内容左右也贴边；
     不裁剪，让右栏能通过负偏移贴到 .content 的 padding 边缘（由 .content overflow:hidden 兜底） */
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
  /* 让出右栏宽度（320px），与右栏左边缘贴齐，无间距 */
  margin-right: 320px;
  /* 底部 -24px 抵消 .content 的 padding-bottom，让裁剪范围卡片底部与右栏（窗口底部）贴齐 */
  margin-bottom: -24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

/* 右栏贴住内容区上/下/右边缘，左侧与左列贴合：
   .page 已通过 margin 左右贴边，故 right 为 0；
   top/bottom -24px 对应 .content 的 padding(24px)，若以后修改需同步调整 */
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

/* 视频按容器自动等比缩放：max-width/height 限制边界，width/height auto 保持比例 */
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

/* ---------- 裁剪面板 ---------- */
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

/* 右列面板撑满高度，内部列表滚动；直角贴边 */
.right-panel {
  flex: 1;
  min-height: 0;
}

/* 左列底部固定区域（视频信息 + 裁剪范围面板）贴底，与右列面板底部对齐 */

.crop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: #334155;
}

.duration-info {
  font-size: 13px;
  font-weight: 400;
  color: #94a3b8;
}

/* ---------- 裁剪模式 switch ---------- */
.mode-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mode-label {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
}

.mode-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-text {
  font-size: 13px;
  color: #94a3b8;
  white-space: nowrap;
  transition: color 0.2s;
}

.mode-text.active {
  font-weight: 600;
  color: #2563eb;
}

.mode-text.active:last-child {
  color: #f97316;
}

.mode-tip {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
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

/* 已添加片段的高亮（浅色，区分于当前选区） */
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

/* 起点滑块置于上层，避免与终点滑块叠加时被遮挡/串扰 */
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
  /* 夹子式手柄：白色小矩形 + 中间蓝色竖线，类似 PS 色值选择器 */
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

/* 操作按钮 */
.crop-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

/* ---------- 裁剪片段列表 ---------- */
.clips-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border-top: 1px solid #e2e8f0;
  padding-top: 12px;
}

/* 右列作为主面板时列表不再需要上边框 */
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

/* 应用裁剪按钮栏 */
.apply-bar {
  display: flex;
  margin-top: 4px;
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

/* 片段第二行：时长 + 操作按钮 */
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

/* ---------- 裁剪进度 ---------- */
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
