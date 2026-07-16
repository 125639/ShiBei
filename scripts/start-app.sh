#!/bin/sh
set -e

# 按 APP_MODE 决定启动什么:
#   full     — 当前默认行为:迁移 + seed + Next.js + (worker 由 docker-compose 起独立容器)
#   backend  — 同 full,但 Next.js 中间件会把公开路由重定向到 /admin
#   frontend — 迁移 + seed + Next.js + 轻量 sync-worker(网页端保存配置后无需重启)
APP_MODE="${APP_MODE:-full}"
SYNC_MODE="${SYNC_MODE:-auto}"

echo "[start-app] APP_MODE=$APP_MODE SYNC_MODE=$SYNC_MODE"

npx prisma migrate deploy
npm run db:seed

case "$APP_MODE" in
  frontend)
    # 始终启动轻量 sync-worker。它每轮读取数据库/环境变量配置；即使启动时尚未配置
    # backend 地址，也可在 /admin/sync 保存后自动开始工作。
    echo "[start-app] frontend:并发启动 sync-worker(带崩溃自动重启)"
    # 同步任务大部分时间空闲，单独限制为 128MB，给 ZIP Buffer、Prisma
    # 和 Next 的原生内存留余量；可用 SYNC_WORKER_NODE_OPTIONS 显式覆盖。
    # 监督循环：sync-worker 意外退出(OOM、未捕获异常)时 5 秒后自动重启，
    # 否则同步会静默死亡直到容器重启。
    (
      set +e
      while :; do
        NODE_OPTIONS="${SYNC_WORKER_NODE_OPTIONS:---max-old-space-size=128}" npm run sync-worker
        echo "[start-app] sync-worker 退出(code=$?),5 秒后自动重启"
        sleep 5
      done
    ) &
    SYNC_WORKER_PID=$!
    # 主进程退出时干掉监督循环；容器停止时残余子进程随之回收
    trap 'kill $SYNC_WORKER_PID 2>/dev/null || true' INT TERM EXIT
    exec npm run start
    ;;
  backend)
    # backend 模式不在容器里跑 BullMQ worker;worker 由 docker-compose 单独起。
    exec npm run start
    ;;
  full|*)
    exec npm run start
    ;;
esac
