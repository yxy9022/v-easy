# 开发指南

面向开发者的本地开发、打包与发布说明。普通用户请查看 [README](./README.md)。

## 环境要求

- Node.js >= 22
- npm

## 本地开发

```bash
npm install
npm run dev
```

## 本地打包

```bash
npm run build          # 仅构建（electron-vite）
npm run build:mac      # 打包 macOS
npm run build:win      # 打包 Windows
npm run build:linux    # 打包 Linux
```

产物输出到 `dist/`。

### 打包注意事项

- `electron-builder.yml` 中 `mac.identity: '-'` 为 ad-hoc 深度签名，**不可改为 `null`**。
  `asarUnpack` 会解包 ffmpeg，若不做签名，Electron 框架自带签名与实际资源不符，
  macOS 会判定应用「已损坏」且无法打开。
- 修改打包配置后，建议先本地执行 `npx electron-builder --mac` 并用
  `spctl -a -vv dist/mac-arm64/v-easy.app` 校验产物，再触发 CI 发布。

## 发布新版本

项目通过 GitHub Actions 自动打包并发布到 [Releases](https://github.com/yxy9022/v-easy/releases)。

### 自动发布（推荐）

推送 `v` 开头的 tag 即触发 CI，自动完成 macOS 与 Windows 双平台打包并发布：

```bash
# 1. 修改 package.json 中的 version
# 2. 提交并推送
git add -A && git commit -m "release: v1.0.2"
git push

# 3. 打 tag 并推送，触发自动发布
git tag v1.0.2
git push origin v1.0.2
```

CI 发布流程（`.github/workflows/release.yml`）分三步：

1. `release-mac` — 创建草稿 Release 并上传 macOS 安装包
2. `release-win` — 追加 Windows 安装包到同一草稿
3. `publish-release` — 调用 API 将草稿转正为正式发布

采用「先草稿后转正」是因为直接创建正式 Release 会因 tag 尚未生效而报
`422 Published releases must have a valid tag`。

### 仓库 Secrets

在仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 用途 |
| --- | --- |
| `GH_TOKEN` | 必填。Personal Access Token（classic），需 `repo` 权限 |
| `APPLE_ID` | 可选。macOS 公证用 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 可选。macOS 公证用 |
| `APPLE_TEAM_ID` | 可选。macOS 公证用 |

未配置 Apple 相关变量时跳过公证，产物为未公证状态，用户需右键 → 打开。

### 本地发布

使用发布脚本（从 `.env` 读取 `GH_TOKEN`，`.env` 已被 git 忽略，不要提交）：

```bash
./release.sh              # 发布 macOS 版
./release.sh win          # 发布 Windows 版
./release.sh win 1.0.2    # 先改版本号再发布
./release.sh --dry        # 仅打包不发布
```

## 项目结构

```text
v-easy
├── build/                        # 打包资源（应用图标、macOS entitlements 等）
├── resources/                    # 运行时资源（asarUnpack 解包使用）
├── src/
│   ├── main/                     # Electron 主进程
│   ├── preload/                  # 预加载脚本（渲染进程与主进程通信的桥接层）
│   └── renderer/                 # 渲染进程（Vue 应用）
├── out/                          # 构建输出目录（electron-vite build 生成）
├── electron-builder.yml          # electron-builder 打包配置
├── electron.vite.config.mjs      # electron-vite 构建配置
└── package.json
```

> `@renderer` 为 `src/renderer/src` 的路径别名（见 `electron.vite.config.mjs`），
> 渲染进程代码中可通过 `@renderer/xxx` 引用资源。
