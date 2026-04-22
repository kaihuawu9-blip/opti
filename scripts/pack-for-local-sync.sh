#!/usr/bin/env bash
# 在云服务器上执行：把镜售项目打成压缩包，供本机 scp 拉回（排除 node_modules、.next 等大目录）
set -euo pipefail
ROOT="/root/sale-system"
OUT="/tmp/sale-system-latest-sync.tgz"
TMP="${OUT}.tmp"

if [[ ! -d "$ROOT" ]]; then
  echo "错误: 未找到 $ROOT"
  exit 1
fi

tar czf "$TMP" \
  -C "$(dirname "$ROOT")" \
  --exclude='sale-system/node_modules' \
  --exclude='sale-system/.next' \
  --exclude='sale-system/out' \
  --exclude='sale-system/.electron-export-stash' \
  --exclude='sale-system/.git' \
  sale-system

mv -f "$TMP" "$OUT"
echo "已生成: $OUT"
ls -lh "$OUT"
echo ""
echo "本机拉取示例:"
echo "  scp root@<公网IP>:$OUT %TEMP%\\"
echo "  然后在 sale 的上一级目录解压: tar -xzf sale-system-latest-sync.tgz   (Windows 自带 tar)"
