FROM node:22-bookworm AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN npx prisma generate
RUN npm run build
# 运行镜像瘦身（同 Dockerfile.frontend 的说明）：去构建缓存、开发依赖与
# @next/swc 二进制；tsx(worker/seed 运行期要用)已在生产依赖，不受 prune 影响。
RUN rm -rf .next/cache \
 && npm prune --omit=dev \
 && npx prisma generate \
 && rm -rf node_modules/@next/swc-linux-x64-gnu node_modules/@next/swc-linux-x64-musl

FROM base AS runner
ENV NODE_ENV=production
ENV APP_MODE=full
ENV NODE_OPTIONS="--max-old-space-size=700"
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-noto-cjk \
      python3 \
      python3-pip \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*
# yt-dlp: install via pip (the apt package on bookworm is too old to handle
# bilibili/weibo cleanly). Pinned to a recent build.
RUN pip3 install --break-system-packages --no-cache-dir 'yt-dlp>=2024.10.0'
# Chromium 安装只依赖 node_modules 里的 playwright 版本：必须放在业务产物
# （.next/src 等每次提交必变的层）之前，否则每次代码提交都会重新下载数百 MB
# 浏览器 + apt 依赖——正是下方注释想避免、但此前没躲干净的坑。
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
# 国内构建机直连 Playwright 官方 CDN 经常超时；需要时传
# --build-arg PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/
ARG PLAYWRIGHT_DOWNLOAD_HOST=""
ENV PLAYWRIGHT_DOWNLOAD_HOST=${PLAYWRIGHT_DOWNLOAD_HOST}
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# 构建元数据放在所有重层之后：ARG 一变只重建其后的层；放前面会导致
# 每次提交都重装 apt/ffmpeg/chromium（实测把 3 分钟构建拖成 15 分钟）。
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV BUILD_COMMIT=$GIT_COMMIT
ENV BUILD_TIME=$BUILD_TIME
EXPOSE 3000
CMD ["sh", "scripts/start-app.sh"]
