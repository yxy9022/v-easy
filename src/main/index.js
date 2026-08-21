import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { cropVideo } from './crop'
import { removeWatermark } from './watermark'
import { mergeVideos } from './merge'

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      // 上下文隔离：渲染进程与 preload 的 JS 上下文隔离（Electron 12+ 默认开启，显式声明以防误改）
      contextIsolation: true,
      // 不向渲染进程注入 Node 能力（默认即关闭）
      nodeIntegration: false,
      // electron-vite 的 preload 使用 ESM 与完整 Node API（webUtils / ipcRenderer），
      // 需 sandbox: false；隔离性由 contextIsolation + contextBridge 白名单接口保证
      sandbox: false,
      preload: join(__dirname, '../preload/index.js')
    }
  })

  mainWindow.webContents.openDevTools()

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // macOS dev 模式下 Dock 图标默认是 Electron 图标，这里设为应用图标便于预览
  if (process.platform === 'darwin' && is.dev) {
    app.dock.setIcon(icon)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // 获取系统桌面目录路径
  ipcMain.handle('app:get-desktop-path', () => app.getPath('desktop'))

  // 选择输出目录
  ipcMain.handle('crop:select-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择保存目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths || filePaths.length === 0) return { canceled: true }
    return { canceled: false, dirPath: filePaths[0] }
  })

  // 视频裁剪：先让用户选择保存路径，再启动 ffmpeg 任务
  ipcMain.handle('crop:start', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    let outputPath = payload.outputPath

    // 已预选保存目录：自动生成文件名
    if (!outputPath && payload.outputDir) {
      outputPath = join(payload.outputDir, `裁剪结果_${Date.now()}.mp4`)
    }

    // 未指定输出路径：弹出保存对话框
    if (!outputPath) {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '保存裁剪后的视频',
        defaultPath: `裁剪结果_${Date.now()}.mp4`,
        filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
      })
      if (canceled || !filePath) return { canceled: true }
      outputPath = filePath
    }

    await cropVideo(event, { ...payload, outputPath })
    return { canceled: false }
  })

  // 视频去水印：先让用户选择保存路径，再启动 ffmpeg 任务
  ipcMain.handle('watermark:start', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    let outputPath = payload.outputPath

    // 已预选保存目录：自动生成文件名
    if (!outputPath && payload.outputDir) {
      outputPath = join(payload.outputDir, `去水印结果_${Date.now()}.mp4`)
    }

    // 未指定输出路径：弹出保存对话框
    if (!outputPath) {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '保存去水印后的视频',
        defaultPath: `去水印结果_${Date.now()}.mp4`,
        filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
      })
      if (canceled || !filePath) return { canceled: true }
      outputPath = filePath
    }

    await removeWatermark(event, { ...payload, outputPath })
    return { canceled: false }
  })

  // 视频合并：先让用户选择保存路径，再启动 ffmpeg 任务
  ipcMain.handle('merge:start', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    let outputPath = payload.outputPath

    // 已预选保存目录：自动生成文件名
    if (!outputPath && payload.outputDir) {
      outputPath = join(payload.outputDir, `合并结果_${Date.now()}.mp4`)
    }

    // 未指定输出路径：弹出保存对话框
    if (!outputPath) {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '保存合并后的视频',
        defaultPath: `合并结果_${Date.now()}.mp4`,
        filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
      })
      if (canceled || !filePath) return { canceled: true }
      outputPath = filePath
    }

    await mergeVideos(event, { ...payload, outputPath })
    return { canceled: false }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
