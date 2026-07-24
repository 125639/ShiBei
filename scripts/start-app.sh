#!/bin/sh
set -e

# 按 APP_MODE 决定启动什么:
#   full     — 当前默认行为:迁移 + seed + Next.js + (worker 由 docker-compose 起独立容器)
#   backend  — 同 full,但 Next.js 中间件会把公开路由重定向到 /admin
#   frontend — 迁移 + seed + Next.js + 轻量 sync-worker(网页端保存配置后无需重启)
APP_MODE="${APP_MODE:-full}"
SYNC_MODE="${SYNC_MODE:-auto}"

echo "[start-app] APP_MODE=$APP_MODE SYNC_MODE=$SYNC_MODE"

# 直接调 node_modules 里的入口,不走 npm/npx 包装:
#  - npm run 的父进程会常驻 ~30-60MB,1核1G 机器上 app + sync-worker 两个包装
#    就是近百 MB 白烧;
#  - npm 对 SIGTERM 的转发不可靠,docker stop 常要等满 10s 宽限期再被 SIGKILL;
#    exec node 让服务进程直接收信号,秒级优雅退出;
#  - 顺带省去每次启动 npm 解析 package.json 的开销(低配机上每次数秒)。
PRISMA=node_modules/.bin/prisma
TSX=node_modules/.bin/tsx

node "$PRISMA" migrate deploy
node "$TSX" prisma/seed.ts

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
        NODE_OPTIONS="${SYNC_WORKER_NODE_OPTIONS:---max-old-space-size=128}" node "$TSX" src/sync-worker/index.ts
        echo "[start-app] sync-worker 退出(code=$?),5 秒后自动重启"
        sleep 5
      done
    ) &
    # 注意不要在这里 trap 收尾——`exec` 替换进程映像后 shell trap 全部失效，
    # 写了也永远不会触发。监督循环的回收由 compose 的 `init: true`(docker-init
    # 作为 PID 1)在容器停止时完成。
    exec node scripts/trusted-next-server.mjs
    ;;
  backend)
    # backend 模式不在容器里跑 BullMQ worker;worker 由 docker-compose 单独起。
    exec node scripts/trusted-next-server.mjs
    ;;
  full|*)
    exec node scripts/trusted-next-server.mjs
    ;;
esac
