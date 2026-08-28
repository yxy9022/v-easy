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

## 功能

- 视频裁剪
- 视频去水印（支持 AI 去水印）
- 视频合并
- 视频压缩
- 视频转码
- 视频加速

所有处理均在本地完成，无需上传，保护隐私。

## 常见问题

### 提示「无法验证开发者」是否正常？

正常。应用为个人开发的免费开源项目，未经过 Apple 公证。
按上方 [macOS 首次打开说明](#macos-首次打开说明) 操作即可，应用本身完好。

### 处理视频时卡顿？

视频处理尤其是 AI 去水印属于计算密集型任务，耗时与视频时长、分辨率相关，属正常现象。

## 开发者

开发、打包与发布相关说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
