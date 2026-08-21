# v-easy

 一款便捷的视频处理应用

## Project Structure

```text
v-easy
├── build/                        # 打包资源（应用图标、macOS entitlements 等）
│   ├── entitlements.mac.plist    # macOS 权限声明
│   ├── icon.icns                 # macOS 应用图标
│   ├── icon.ico                  # Windows 应用图标
│   └── icon.png                  # Linux 应用图标
├── resources/                    # 运行时资源（asarUnpack 解包使用）
├── src/
│   ├── main/                     # Electron 主进程
│   │   └── index.js              # 主进程入口：创建窗口、生命周期管理
│   ├── preload/                  # 预加载脚本（渲染进程与主进程通信的桥接层）
│   │   └── index.js
│   └── renderer/                 # 渲染进程（Vue 应用）
│       ├── index.html            # 渲染进程 HTML 入口
│       └── src/
│           ├── assets/           # 静态资源（图片、样式等）
│           ├── components/       # Vue 组件
│           ├── App.vue           # 根组件
│           └── main.js           # Vue 应用入口
├── out/                          # 构建输出目录（electron-vite build 生成）
├── electron-builder.yml          # electron-builder 打包配置
├── electron.vite.config.mjs      # electron-vite 构建配置
├── eslint.config.mjs             # ESLint 配置
├── package.json
└── yarn.lock
```

> 说明：`@renderer` 为 `src/renderer/src` 的路径别名（见 `electron.vite.config.mjs`），渲染进程代码中可通过 `@renderer/xxx` 引用资源。

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
