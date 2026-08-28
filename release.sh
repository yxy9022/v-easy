#!/usr/bin/env bash
#
# v-easy 发布脚本
# 用法：
#   ./release.sh             # 默认发布到 GitHub Releases（mac）
#   ./release.sh win         # 发布 Windows 版
#   ./release.sh mac         # 发布 macOS 版
#   ./release.sh 1.0.1       # 先改版本号再发布（mac）
#   ./release.sh win 1.0.1   # 改版本号并发布 Windows 版
#   ./release.sh --dry       # 只打包不发布（本地验证）
#
# 前置：
#   1. 在 GitHub 生成 Personal access token (classic)，勾选 repo 权限
#   2. 把 token 放进环境变量 GH_TOKEN（或本脚本同目录的 .env 文件，勿提交）
#   3. 如需 Mac 公证，额外配置 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
#
set -euo pipefail

# 读取同目录 .env（若存在），用于本地保存 GH_TOKEN 等，请勿提交到 git
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  # shellcheck disable=SC1090
  source "$SCRIPT_DIR/.env"
fi

PLATFORM="${1:-mac}"
NEW_VERSION="${2:-}"
DRY_RUN=0

# 解析 --dry
for arg in "$@"; do
  if [[ "$arg" == "--dry" ]]; then
    DRY_RUN=1
    shift || true
  fi
done

# 校验平台
case "$PLATFORM" in
  mac|win|linux) ;;
  *)
    echo "❌ 未知平台: $PLATFORM （可选 mac / win / linux）"
    exit 1
    ;;
esac

# 更新版本号
if [[ -n "$NEW_VERSION" ]]; then
  if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "❌ 版本号格式不正确: $NEW_VERSION （应为 x.y.z，如 1.0.1）"
    exit 1
  fi
  echo "🔧 更新版本号 -> $NEW_VERSION"
  # 用 node 安全修改 package.json 的 version 字段
  node -e "const fs=require('fs');const p='$SCRIPT_DIR/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version='$NEW_VERSION';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
fi

# 检查 token
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "❌ 未设置 GH_TOKEN 环境变量"
  echo "   请先 export GH_TOKEN='ghp_xxx' 或在 .env 文件中配置"
  exit 1
fi

# 组装发布参数
PUBLISH_FLAG="--publish=always"
if [[ "$DRY_RUN" -eq 1 ]]; then
  PUBLISH_FLAG=""
  echo "🧪 干跑模式：仅打包，不发布"
fi

echo "🚀 开始打包并发布 [$PLATFORM] ..."
case "$PLATFORM" in
  mac)   npm run build:mac -- "$PUBLISH_FLAG" ;;
  win)   npm run build:win -- "$PUBLISH_FLAG" ;;
  linux) npm run build:linux -- "$PUBLISH_FLAG" ;;
esac

echo "✅ 完成！Release 页面：https://github.com/yxy9022/v-easy/releases"
