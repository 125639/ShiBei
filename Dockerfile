FROM node:22-bookworm AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install

FROM deps AS builder
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV APP_MODE=full
ENV NODE_OPTIONS="--max-old-space-size=1024"
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
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
RUN npx playwright install --with-deps chromium
EXPOSE 3000
CMD ["sh", "scripts/start-app.sh"]
