<script setup>
import { ref } from 'vue'

defineProps({
  // 文件选择器的 accept，如 'video/*'、'image/*'、'.mp4,.mov'
  accept: { type: String, default: 'video/*' },
  multiple: { type: Boolean, default: false },
  // 上传按钮文字
  buttonText: { type: String, default: '上传视频' },
  // 按钮下方单行提示（tips 为空时使用）
  tip: { type: String, default: '' },
  // 按钮下方多行提示，每项一行（优先级高于 tip）
  tips: { type: Array, default: () => [] }
})

// 选中/拖入单个文件后触发，类型校验由使用方负责
const emit = defineEmits(['select'])

const fileInput = ref(null)
const isDragging = ref(false)

function openFilePicker() {
  fileInput.value?.click()
}

function onFileChange(e) {
  const file = e.target.files[0]
  if (file) emit('select', file)
  // 重置 input 值，便于再次选择同一文件时仍能触发 change
  e.target.value = ''
}

function onDragOver(e) {
  e.preventDefault()
  isDragging.value = true
}

function onDragLeave() {
  isDragging.value = false
}

function onDrop(e) {
  e.preventDefault()
  isDragging.value = false
  const file = e.dataTransfer.files[0]
  if (file) emit('select', file)
}
</script>

<template>
  <div
    class="upload-zone"
    :class="{ dragging: isDragging }"
    @click="openFilePicker"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <input
      ref="fileInput"
      type="file"
      :accept="accept"
      :multiple="multiple"
      hidden
      @change="onFileChange"
    />
    <button type="button" class="upload-btn">
      <svg
        class="upload-btn-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 16V4m0 0 4 4m-4-4-4 4" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
      <span>{{ buttonText }}</span>
    </button>
    <p v-for="line in tips" :key="line" class="upload-tip">{{ line }}</p>
    <p v-if="!tips.length && tip" class="upload-tip">{{ tip }}</p>
  </div>
</template>

<style scoped>
.upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  max-width: 480px;
  height: 260px;
  min-height: min(220px, 50vh);
  max-height: 60vh;
  margin: 0 auto;
  border: 2px dashed #cbd5e1;
  border-radius: 12px;
  background-color: #ffffff;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.upload-zone:hover,
.upload-zone.dragging {
  border-color: #2563eb;
  background-color: #eff6ff;
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 40px;
  border: none;
  border-radius: 10px;
  background-color: #2563eb;
  color: #ffffff;
  font-size: 17px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s;
  pointer-events: none;
}

.upload-btn-icon {
  width: 22px;
  height: 22px;
}

.upload-tip {
  margin: 0;
  font-size: 13px;
  color: #94a3b8;
}
</style>
