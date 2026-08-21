import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // 获取渲染进程 File 对象对应的本地真实路径
  getPathForFile: (file) => webUtils.getPathForFile(file),
  // 获取系统桌面目录路径
  getDesktopPath: () => ipcRenderer.invoke('app:get-desktop-path'),
  // 选择输出目录，返回 { canceled, dirPath }
  selectDirectory: () => ipcRenderer.invoke('crop:select-directory'),
  // 启动裁剪任务（主进程会弹保存对话框），返回 { canceled }
  cropVideo: (payload) => ipcRenderer.invoke('crop:start', payload),
  // 以下返回取消监听的函数，便于组件卸载时清理
  onCropProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('crop:progress', listener)
    return () => ipcRenderer.removeListener('crop:progress', listener)
  },
  onCropDone: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('crop:done', listener)
    return () => ipcRenderer.removeListener('crop:done', listener)
  },
  onCropError: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('crop:error', listener)
    return () => ipcRenderer.removeListener('crop:error', listener)
  },
  // 启动去水印任务（主进程会弹保存对话框），返回 { canceled }
  removeWatermark: (payload) => ipcRenderer.invoke('watermark:start', payload),
  onWatermarkProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('watermark:progress', listener)
    return () => ipcRenderer.removeListener('watermark:progress', listener)
  },
  onWatermarkDone: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('watermark:done', listener)
    return () => ipcRenderer.removeListener('watermark:done', listener)
  },
  onWatermarkError: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('watermark:error', listener)
    return () => ipcRenderer.removeListener('watermark:error', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
