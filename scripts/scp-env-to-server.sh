#!/usr/bin/env bash
# 本机 → 云：把含 TENCENT_SECRET_KEY 的环境文件上传到 ECS（默认与 pm2 规则一致）
# 用法：
#   REMOTE=root@你的服务器IP \
#   ENV_FILE=./.env.local \
#   bash scripts/scp-env-to-server.sh
set -euo pipefail

REMOTE="${REMOTE:-root@114.55.227.24}"
REMOTE_PATH="${REMOTE_PATH:-/root/sale-system/.env.local}"
ENV_FILE="${ENV_FILE:-.env.local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "找不到文件: $ENV_FILE（请设置 ENV_FILE=路径）" >&2
  exit 1
fi

scp "$ENV_FILE" "${REMOTE}:${REMOTE_PATH}"
echo "上传完成。请在服务器执行:"
echo "  chmod 600 ${REMOTE_PATH}"
echo "  cd /root/sale-system && pm2 restart opti-ai --update-env"
