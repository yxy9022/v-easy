# v-easy

一款便捷的视频处理应用

## 下载安装

前往 [Releases](https://github.com/yxy9022/v-easy/releases) 页面下载对应平台的安装包。

| 平台 | 下载文件 | 说明 |
| --- | --- | --- |
| macOS | `v-easy-<version>.dmg` | 挂载后将 `v-easy.app` 拖入「应用程序」文件夹 |
| macOS | `v-easy-<version>-arm64-mac.zip` | 解压后直接得到 `v-easy.app`（Apple 芯片） |
| Windows | `v-easy-<version>-setup.exe` | 双击运行安装向导 |

### macOS 首次打开说明

由于应用未经过 Apple 公证（notarize），首次打开时 macOS 会提示
「无法验证开发者」或「Apple 无法检查其是否包含恶意软件」。
**这是正常现象，应用本身完好**，按以下步骤打开即可：

1. 关闭提示弹窗
2. 在「应用程序」中找到 `v-easy.app`
3. **右键**点击 → 选择「打开」
4. 在弹出的提示中点「打开」

完成一次后，之后双击即可正常启动。

若右键打开仍提示「已损坏」，执行以下命令清除隔离属性后重新打开：

```bash
sudo xattr -cr /Applications/v-easy.app
```

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

## 发布新版本

项目通过 GitHub Actions 自动打包并发布到 [Releases](https://github.com/yxy9022/v-easy/releases)。

### 自动发布（推荐）

推送一个 `v` 开头的 tag 即触发 CI，自动完成 macOS 与 Windows 双平台打包并发布：

```bash
# 1. 修改 package.json 中的 version
# 2. 提交并推送
$ git add -A && git commit -m "release: v1.0.2"
$ git push

# 3. 打 tag 并推送，触发自动发布
$ git tag v1.0.2
$ git push origin v1.0.2
```

CI 需要仓库 Secrets 中配置 `GH_TOKEN`（Personal Access Token，需 `repo` 权限）。
如需 macOS 公证，额外配置 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。

### 本地发布

也可使用发布脚本（从 `.env` 读取 `GH_TOKEN`，`.env` 已被 git 忽略）：

```bash
$ ./release.sh              # 发布 macOS 版
$ ./release.sh win          # 发布 Windows 版
$ ./release.sh win 1.0.2    # 先改版本号再发布
$ ./release.sh --dry        # 仅打包不发布
```
