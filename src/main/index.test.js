import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// hoisted 共享状态：供 vi.mock 工厂与测试用例共同读写
const st = vi.hoisted(() => ({
  isDev: false,
  windowInstances: [],
  BrowserWindow: null,
  shell: null
}))

// ---- Mock electron：BrowserWindow / app / ipcMain / dialog / shell ----
vi.mock('electron', () => {
  const createMockWindow = () => {
    const handlers = {}
    const win = {
      webContents: {
        openDevTools: vi.fn(),
        setWindowOpenHandler: vi.fn((cb) => {
          win._openHandler = cb
        })
      },
      on: vi.fn((event, cb) => {
        handlers[event] = cb
      }),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      show: vi.fn(),
      _handlers: handlers,
      _openHandler: null
    }
    return win
  }

  const BrowserWindow = vi.fn(() => {
    const win = createMockWindow()
    st.windowInstances.push(win)
    return win
  })
  st.BrowserWindow = BrowserWindow
  st.shell = { openExternal: vi.fn() }

  return {
    app: {
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      getPath: vi.fn(() => '/Users/test/Desktop'),
      quit: vi.fn(),
      dock: { setIcon: vi.fn() }
    },
    BrowserWindow,
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    shell: st.shell
  }
})

// ---- Mock electron-toolkit：is.dev 支持运行时切换 ----
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: {
    get dev() {
      return st.isDev
    }
  }
}))

// ---- Mock 本地处理模块，隔离 ffmpeg 等重依赖 ----
vi.mock('./crop', () => ({ cropVideo: vi.fn() }))
vi.mock('./watermark', () => ({ removeWatermark: vi.fn() }))
vi.mock('./merge', () => ({ mergeVideos: vi.fn() }))
vi.mock('./compress', () => ({ compressVideo: vi.fn() }))
vi.mock('./convert', () => ({ convertVideo: vi.fn() }))

/** 重新加载 index.js（未导出 createWindow，靠 mock 的 whenReady 回调触发），等待窗口创建完成 */
async function loadIndex() {
  vi.resetModules()
  await import('./index.js')
  await vi.waitFor(() => {
    expect(st.windowInstances.length).toBeGreaterThan(0)
  })
}

beforeEach(() => {
  st.isDev = false
  st.windowInstances.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  delete process.env.ELECTRON_RENDERER_URL
})

describe('createWindow 窗口创建', () => {
  it('使用正确的窗口配置创建 BrowserWindow', async () => {
    await loadIndex()

    expect(st.BrowserWindow).toHaveBeenCalledTimes(1)
    expect(st.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 900,
        height: 670,
        show: false,
        title: 'v-easy',
        autoHideMenuBar: true,
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          preload: expect.stringContaining('../preload/index.js')
        })
      })
    )
  })

  it('ready-to-show 事件触发后显示窗口', async () => {
    await loadIndex()

    const win = st.windowInstances[0]
    expect(win.show).not.toHaveBeenCalled()

    win._handlers['ready-to-show']()
    expect(win.show).toHaveBeenCalledTimes(1)
  })

  it('生产环境加载本地 index.html', async () => {
    st.isDev = false
    await loadIndex()

    const win = st.windowInstances[0]
    expect(win.loadFile).toHaveBeenCalledTimes(1)
    expect(win.loadFile).toHaveBeenCalledWith(expect.stringContaining('index.html'))
    expect(win.loadURL).not.toHaveBeenCalled()
  })

  it('开发环境加载 ELECTRON_RENDERER_URL 远程地址', async () => {
    st.isDev = true
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    await loadIndex()

    const win = st.windowInstances[0]
    expect(win.loadURL).toHaveBeenCalledTimes(1)
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    expect(win.loadFile).not.toHaveBeenCalled()
  })

  it('开发环境自动打开 DevTools', async () => {
    st.isDev = true
    await loadIndex()

    const win = st.windowInstances[0]
    expect(win.webContents.openDevTools).toHaveBeenCalledTimes(1)
  })

  it('生产环境不打开 DevTools', async () => {
    st.isDev = false
    await loadIndex()

    const win = st.windowInstances[0]
    expect(win.webContents.openDevTools).not.toHaveBeenCalled()
  })

  it('setWindowOpenHandler 拦截外链并交给系统浏览器', async () => {
    await loadIndex()

    const win = st.windowInstances[0]
    const url = 'https://example.com/some/path'
    const result = win._openHandler({ url })

    expect(result).toEqual({ action: 'deny' })
    expect(st.shell.openExternal).toHaveBeenCalledWith(url)
  })

  it('linux 平台为窗口设置应用图标', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      await loadIndex()
      expect(st.BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({ icon: 'mock-icon.png' })
      )
    } finally {
      Object.defineProperty(process, 'platform', original)
    }
  })
})
