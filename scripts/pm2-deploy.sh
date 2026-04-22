#!/usr/bin/env bash
# 与 .cursor/rules/deploy-node-pm2.mdc 一致：构建后重启 PM2（opti-ai）
set -euo pipefail
cd /root/sale-system
npm run build
pm2 restart opti-ai --update-env
pm2 logs opti-ai --lines 40 --nostream
