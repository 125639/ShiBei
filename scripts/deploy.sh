#!/usr/bin/env bash
# 一键部署（full 模式）：用当前源码构建镜像并上线 app + worker。
# 把 git commit / 构建时间烤进镜像，admin 仪表盘和 /api/health 会显示，
# 一眼看出线上跑的是哪个版本——不再靠猜镜像新旧。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
if ! git diff --quiet HEAD 2>/dev/null; then
  GIT_COMMIT="${GIT_COMMIT}-dirty"
fi
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export GIT_COMMIT BUILD_TIME

echo "[deploy] 构建 ${GIT_COMMIT}（${BUILD_TIME}）"
docker compose build app
docker compose up -d app worker
docker compose ps app worker
echo "[deploy] 完成。验证：curl -s http://localhost:3000/api/health"
