# 拾贝 ShiBei — 信息整理博客系统

> **一个把"抓取资料 → AI 整理 → 人工审核 → 前台轻量阅读"串成一条流水线的个人/小团队博客。**
> 既能单机一体，也能拆成前端 + 后端两台服务器分别部署。

[![Node](https://img.shields.io/badge/node-22--bookworm-43853d?logo=node.js)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?logo=next.js)](https://nextjs.org/)
[![Postgres](https://img.shields.io/badge/Postgres-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#许可)

---

## 目录

- [项目特点](#项目特点)
- [三种部署形态](#三种部署形态)
- [快速上手](#快速上手docker)
- [跨服务器部署（公网）](#跨服务器部署公网)
- [AI 模型接入](#ai-模型接入)
- [本地开发](#本地开发)
- [架构与目录](#架构与目录)
- [常用运维命令](#常用运维命令)
- [常见问题](#常见问题排查清单)
- [安全建议](#安全建议)
- [License](#许可)

---

## 项目特点

### 表示层 / 用户界面

- **响应式**：480 / 820 / 960 px 三个断点，桌面 + 手机端都已适配；移动端 admin 侧边栏自动变 sticky 顶部条。
- **多主题**：`minimal`（简约/默认）/ `dark` / `sepia` / `ocean` / `forest` / `sunset` / `midnight`，全部走 CSS 变量。
- **多字体**：6 种**全部为免费字体**（系统字体或 Source Han / Noto / LXGW WenKai / FangSong），用户可在 `/settings` 自由切换并存入 localStorage。
- **管理员默认主题/字体**：`/admin/settings` 设置；用户首次访问时使用管理员的默认值，未设置则回退到「简约 + 衬线」。
- **数据可视化**：`/stats`（公开）+ `/admin/stats`（管理员）共 6 张图，全部 SVG + CSS 实现，零第三方图表库依赖；提供「当天 / 本周 / 全部」3 个时间窗口。

### 业务逻辑

- **AI 全局提示词前缀**：`SiteSettings.globalPromptPrefix`，自动加到每次 AI 请求的 system 之前，便于统一调教语气。
- **自动抓取调度**：管理员可定义主题、关键词、cron 时间表、生成数量，系统会按计划运行抓取任务，自动发布开关与发布时间点都可控。
- **信息源 + 视频源相辅相成**：抓页面时同时识别 `<video>` / 视频链接，按 host 区分国内/国外：
  - 国外视频：保留 EMBED 或 LINK，无版权下载风险。
  - 国内视频（B 站、微博、爱奇艺、优酷、腾讯视频、抖音等）：尝试用 `yt-dlp` 下载，**单文章最多 1 个，限时长 ≤ 20 分钟**；每个视频都附带「来源页 + 原始链接 + 平台 + 版权说明」。
- **信息源模块化**：`SourceModule` 表，源可关联多个模块（AI / 财经 / 娱乐 …），主题抓取时只用关联模块的源，效率与相关性更高；管理员还可启用 [Exa](https://exa.ai) 作为额外检索引擎。
- **音乐**：`/admin/music` 上传 MP3/M4A/OGG/WAV（≤30 MB），用户在 `/settings` 启用并选曲，全站浮动播放器（折叠/换曲/音量/关闭）。
- **多语言**：默认中文；管理员可选「双语模式」或「默认语种模式」。在默认语种模式下，用户切到英文时打开新闻会调 AI 自动翻译并写入缓存（`titleEn` / `summaryEn` / `contentEn`），下次复用。
- **AI 助手**：博客主页 + 文章页内嵌 `AiAssistant`，模型由管理员在 `/admin/settings` 配置；用户可与 AI 探讨页面新闻内容。
- **用户写作工作台**：`/write` 提供独立写作区，**不计入博客内容**，用户写完可下载保存。AI 辅助使用管理员预设的「写作模型」；用户也可填入自己的 baseUrl / apiKey / model 走自定义模型。

### 数据访问层

- **存储管理**：`SiteSettings` 内置 `maxStorageMb` / `cleanupAfterDays`（3 天 / 7 天 / 1 月 / 3 月 / 自定义）/ `cleanupCustomEnabled` / `textOnlyMode` / `videoMaxDurationSec` / `videoDownloadDomestic`。
- **纯文本模式**：开启后抓取不附加视频文件，仅整理文本与提供链接，进一步省空间。
- **定期清理**：worker 每 6 小时执行一次：超期 FetchJob 删除、孤儿 RawItem 删除、超额时旧文章自动归档（不删内容），归档文章本地视频文件回收。也可在 `/admin/storage/cleanup` 手动一键执行。

### 性能

- `PublicShell` 把站点设置走 `unstable_cache`（60s + tag-based revalidation），管理员保存时立即刷新。
- `next.config.ts`：`/_next/static/*` 1 年 immutable，`/uploads/*` 1 小时缓存；启用 compress；`optimizePackageImports`。
- 公开页全部命中缓存，加上 LCP 关键资源直接 inline CSS，1 核 1G 也能轻松扛住几十 QPS。

---

## 三种部署形态

| 形态 | `APP_MODE` | 含 BullMQ Worker | 含 Playwright/yt-dlp | 公开页 | 同步角色 | 推荐资源 |
| --- | --- | --- | --- | --- | --- | --- |
| **完整版** | `full` | ✅ | ✅ | ✅ | 既能导出也能导入 | 2 核 4 GB |
| **后端** | `backend` | ✅ | ✅ | ❌（重定向到 /admin） | 仅导出 | 2 核 2 GB |
| **前端** | `frontend` | ❌ | ❌ | ✅ | 仅导入 | 1 核 1 GB（512 MB 也能跑） |

```text
                 ┌──────────────────────┐
                 │  backend 服务器（重） │
                 │  抓取 / AI / yt-dlp  │
                 │  /admin/sync/export │ ──ZIP──┐
                 └──────────────────────┘        │  HTTPS + Bearer SYNC_TOKEN
                                                 ▼
                 ┌──────────────────────┐
                 │  frontend 服务器（轻）│
                 │  Next.js 展示 + 同步  │
                 │  AI 调用透明转发      │
                 └──────────────────────┘
```

- **完整版**适合一台 4 GB 服务器自己玩。
- **拆分**适合"内容用大机抓、展示用小机扛流量"——前端镜像不含 Chromium / yt-dlp，启动快、占用少。

---

## 快速上手（Docker）

> 镜像主页：<https://hub.docker.com/r/safg/shibei>
>
> 推荐 Linux 服务器 + Docker 27+ + Docker Compose v2。

### 1) 拉代码 + 准备环境变量

```bash
git clone https://github.com/125639/ShellPick.git
cd ShellPick
cp .env.example .env
# 修改 AUTH_SECRET / ENCRYPTION_KEY / ADMIN_PASSWORD / NEXT_PUBLIC_SITE_URL
```

`AUTH_SECRET` 和 `ENCRYPTION_KEY` 建议 `openssl rand -hex 32` 各生成一份，**改了 ENCRYPTION_KEY 后已加密的 AI Key 会全部失效，需要在后台重填**。

### 2) 启动

| 形态 | 启动命令 |
| --- | --- |
| 完整版 | `docker compose up -d` |
| 后端 | `docker compose -f docker-compose.backend.yml up -d` |
| 前端 | `docker compose -f docker-compose.frontend.yml up -d` |

> Compose 文件里同时保留了 `image:`（拉 Docker Hub 镜像）和 `build:`（本地构建）。
>
> - 默认 `up -d` 会拉 Docker Hub 上的镜像，**几分钟**就能起来。
> - 加 `--build` 会强制本地构建：低内存机器上 Playwright/Chromium 下载 + `next build` 容易 OOM，建议在 4 GB+ 的机器上构建并推到 Docker Hub。

### 3) 访问

```text
http://服务器IP             # 公开站（前端/完整版）
http://服务器IP:3000        # 同上
http://服务器IP:3000/admin  # 管理后台（默认 admin / 你在 .env 里设的密码）
http://服务器IP:3000/api/health  # 健康检查（compose 已用它做 healthcheck）
```

> 容器内监听 3000；前端/完整版的 compose 同时把 `80:3000` 也映射出来，开了 80 端口的服务器可以直接用 IP 访问。
>
> 后端 compose **只暴露 3000**——拆分部署时建议给它套一层 Caddy/Nginx 做 HTTPS。

### 4) 验证

```bash
# 服务状态
docker compose ps

# 健康检查（应返回 {"ok":true,...}）
curl http://localhost:3000/api/health

# 实时日志
docker compose logs -f app worker
```

---

## 跨服务器部署（公网）

**用户场景**：backend 在 A 服务器（比如阿里云）、frontend 在 B 服务器（比如腾讯云）、两台不在同一私网。

### 拓扑示意

```text
[用户浏览器] ──HTTPS──▶ [frontend 服务器 B]
                              │
                              │  HTTPS + Bearer SYNC_TOKEN
                              ▼
                        [backend 服务器 A]
                          ↑
                          └─ 管理员浏览器（写文章）
```

### 步骤

1. **A 服务器（backend）**

   ```bash
   cd /opt/ShellPick && cp .env.example .env
   # 编辑 .env：APP_MODE=backend, AUTH_SECRET, ENCRYPTION_KEY, ADMIN_PASSWORD, NEXT_PUBLIC_SITE_URL=https://api.example.com
   docker compose -f docker-compose.backend.yml up -d

   # 浏览器访问 https://api.example.com/admin 登录，进入 /admin/sync：
   #   1. 生成共享密钥：openssl rand -hex 32 → 填入「共享密钥」并保存
   #   2. /admin/settings 配置 AI 模型（CanopyWave / OpenAI / DeepSeek …）
   #   3. /admin/sources 添加 RSS / 网页源
   #   4. /admin/auto-curation 设置主题与定时调度
   ```

2. **B 服务器（frontend）**

   ```bash
   cd /opt/ShellPick && cp .env.example .env
   # 编辑 .env：APP_MODE=frontend, AUTH_SECRET, ENCRYPTION_KEY, ADMIN_PASSWORD, NEXT_PUBLIC_SITE_URL=https://shibei.example.com
   docker compose -f docker-compose.frontend.yml up -d

   # 浏览器访问 https://shibei.example.com/admin 登录，进入 /admin/sync：
   #   - Backend 入口：https://api.example.com
   #   - 共享密钥：粘贴 backend 上同一串
   #   - 同步模式：自动（默认 15 分钟拉一次）
   #   - 保存。容器内的 sync-worker 会立即开始拉。
   ```

3. **HTTPS 与反向代理（强烈建议）**

   两台服务器都建议套 [Caddy](https://caddyserver.com) 或 Nginx 反代 + Let's Encrypt 自动证书：

   ```caddyfile
   # /etc/caddy/Caddyfile（A 服务器，backend）
   api.example.com {
     reverse_proxy 127.0.0.1:3000
   }

   # /etc/caddy/Caddyfile（B 服务器，frontend）
   shibei.example.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```

   把对应 compose 里的 `"80:3000"` 删掉、只保留 `"127.0.0.1:3000:3000"`，让 Caddy 终止 TLS。

### 安全注意

- **SYNC_TOKEN** 在公网传输，必须用 HTTPS（参考上面 Caddy 配置）。HTTP 等于把密钥裸奔。
- **后端的 `/api/public/*` 在 backend 模式下要求 Bearer SYNC_TOKEN**。本仓库已经把这层校验做进 `src/lib/sync/backend-auth.ts`：没有共享密钥的请求会被 401 拒绝，**避免有人扫到 backend IP 后免费消耗你的 AI Key**。如果你看到日志大量 401，说明确实有人在尝试，但他们打不下来。
- **管理员后台**只对管理员 session 开放，公网暴露相对安全；改完密码、定期换 SYNC_TOKEN 即可。

---

## AI 模型接入

任何兼容 OpenAI `/v1/chat/completions` 协议的服务都能接，登录 `/admin/settings`，在「模型配置」一栏新增即可。本仓库内置常见服务商的 baseUrl/默认 model 预设：

| 预设 | baseUrl | 默认 model |
| --- | --- | --- |
| CanopyWave | `https://inference.canopywave.io/v1` | `moonshotai/kimi-k2.6` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-32k` |
| 通义千问 DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| 自定义 | 任意 baseUrl | 任意 model 名 |

API Key 会用 `ENCRYPTION_KEY` 派生的 AES-256-GCM 加密后入库；后台仅显示「已配置」，不会回显明文。

### Reasoning 模型（Kimi-k2.6 / DeepSeek-R1 / OpenAI o*）

代码已经针对 reasoning 模型做了两件事：

1. 自动把请求超时拉到 600 秒（普通模型 240 秒），适应思考链时间。
2. 当 `choices[0].message.content` 为 `null` 但 `reasoning_content` 有内容时回退使用 reasoning 文本，避免「Model returned empty content」。

### 模型用途分配

`/admin/settings` 中可以为四类用途分别指定模型，未指定时回退到「默认模型」：

- 新闻整理（worker 抓完后调用）
- 站内 AI 助手
- 用户写作助手
- 翻译（单独缺省时回退到 assistant 模型）

---

## 本地开发

```bash
# 1) 准备依赖
npm install

# 2) 启 postgres 与 redis（任意方式，这里用 docker 起两个独立容器）
docker run -d --name dev-pg -e POSTGRES_USER=shibei -e POSTGRES_PASSWORD=shibei -e POSTGRES_DB=shibei_blog -p 5432:5432 postgres:16-alpine
docker run -d --name dev-redis -p 6379:6379 redis:7-alpine

# 3) 准备 .env（指向 127.0.0.1:5432 / 6379）

# 4) 迁移 + 种子
npx prisma migrate deploy
npm run db:seed

# 5) Next.js dev server
npm run dev
# 访问 http://localhost:3000

# 6) 同时跑 worker（仅 backend / full 模式需要）
npm run worker

# 7) frontend 模式可单独起 sync-worker
npm run sync-worker
```

### 类型检查 + 构建

```bash
npx tsc --noEmit          # 静态类型检查
npm run build             # 生产构建（含 prisma generate）
npm run lint              # ESLint
```

### 数据库 Schema 演进

```bash
# 修改 prisma/schema.prisma 后
npx prisma migrate dev --name describe_change
```

迁移脚本是 idempotent 的（`IF NOT EXISTS` 守卫），重复执行不会报错。

---

## 架构与目录

```text
ShellPick/
├── prisma/
│   ├── schema.prisma                # 数据模型（Post / Video / Music / Source / SourceModule / NewsTopic …）
│   ├── seed.ts                      # 初始管理员、默认风格、默认主题/模块
│   └── migrations/                  # 9 份 idempotent SQL 迁移
├── src/
│   ├── middleware.ts                # APP_MODE 路由守卫；frontend 屏蔽抓取相关路径，backend 把公开页重定向到 /admin
│   ├── app/
│   │   ├── (public)/                # 公开页：/、/news、/videos、/stats、/settings、/about、/write
│   │   ├── admin/                   # 管理后台：dashboard、内容、信息源、模块、主题、模型、音乐、视频、同步…
│   │   ├── api/                     # 路由；admin/* 需 session，public/* 公开（backend 模式带 SYNC_TOKEN 校验）
│   │   ├── uploads/[...path]/       # 兜底服务运行时新写入的视频 / 音乐文件（Range 支持）
│   │   └── layout.tsx               # 站点根布局（主题/字体/语言/UI 选择落到 <html data-*>）
│   ├── components/                  # 复用 UI：AdminShell / PublicShell / AiAssistant / Charts / MusicPlayer …
│   ├── lib/
│   │   ├── ai.ts                    # OpenAI-compat 调用封装（含 reasoning 模型超时与 reasoning_content 回退）
│   │   ├── app-mode.ts              # APP_MODE 读取与同步配置默认值
│   │   ├── sync/                    # ZIP 导出 / 导入 / 自动拉取 / 透明代理 / 共享密钥校验
│   │   ├── scrape.ts / scrape-audience.ts  # Playwright 抓页面（仅 backend / full）
│   │   ├── video-downloader.ts      # yt-dlp 下载国内视频（仅 backend / full）
│   │   ├── exa.ts                   # Exa 搜索接入
│   │   ├── stats.ts                 # /stats 数据聚合
│   │   ├── storage.ts               # 上传根目录 + 定期清理
│   │   └── …
│   ├── worker/index.ts              # BullMQ worker：fetch / research / digest / audience / schedule（仅 backend / full）
│   └── sync-worker/index.ts         # frontend 专用轻量 sync-worker（仅 frontend）
├── scripts/
│   ├── start-app.sh                 # APP_MODE 调度的容器入口（迁移 + seed + 启动）
│   └── apply-migration.mjs          # 手工应用 SQL 的辅助脚本
├── Dockerfile                       # 完整版镜像（Playwright + yt-dlp + ffmpeg）
├── Dockerfile.backend               # 后端镜像，与完整版同源，APP_MODE=backend
├── Dockerfile.frontend              # 前端镜像（slim 基础，无 Chromium / yt-dlp，体积小一半）
├── docker-compose.yml               # 完整版（postgres + redis + app + worker）
├── docker-compose.backend.yml       # 后端（postgres + redis + app + worker，APP_MODE=backend）
├── docker-compose.frontend.yml      # 前端（postgres + app，sync-worker 在容器内并发跑）
├── docker-compose.frontdemo.yml     # 演示前端接入既有 backend 的 docker 网络
├── .env.example                     # 必填环境变量样板
├── README.md                        # 本文件
├── SYNC.md                          # 同步协议详细规格
└── DEPLOY_NOTES.md                  # 部署历史记录与变更说明
```

### 数据流（backend → frontend）

```text
1. backend.worker 抓 RSS / 网页 → RawItem（原始）
2. backend.worker 调 AI → Post（DRAFT / PUBLISHED）+ Video
3. backend 管理员审核 → 改 status=PUBLISHED
4. frontend.sync-worker 每 N 分钟 GET backend /api/admin/sync/export?since=...
   带 Authorization: Bearer SYNC_TOKEN
5. backend 把 PUBLISHED 文章 + 视频 metadata 打成 ZIP 返回（默认不含本地视频文件）
6. frontend 解 ZIP，按 updatedAt 比大小做 upsert（incoming 较新才覆盖）
7. SyncState.lastImportedAt = now，下次只拉增量
```

### AI 公开端点的代理（frontend → backend）

```text
浏览器 POST /api/public/assistant
   │
frontend 侧 (isFrontend()=true)
   ↓
proxyToBackend → POST {BACKEND_API_URL}/api/public/assistant
                Authorization: Bearer SYNC_TOKEN
   ↓
backend 侧 (isBackend()=true)
   ↓
ensureBackendCallerAllowed → 校验 Authorization
   ↓
调本地 ModelConfig → CanopyWave / OpenAI / DeepSeek …
   ↓
原样回前端 → 浏览器
```

---

## 常用运维命令

```bash
# 实时日志（按 Ctrl+C 退出）
docker compose logs -f app
docker compose logs -f worker

# 进入容器排查
docker compose exec app sh

# 触发数据库迁移（容器启动时已自动跑 prisma migrate deploy）
docker compose exec app npx prisma migrate deploy

# 升级镜像（使用 Docker Hub 镜像时）
docker compose pull && docker compose up -d

# 关停服务但保留数据
docker compose down

# ⚠️ 关停并删除全部命名卷（数据库、上传文件都会丢）
docker compose down -v

# 检查 frontend / backend 配置
curl http://服务器IP:3000/api/health
docker compose exec app sh -c 'echo $APP_MODE'

# backend 立即生成 ZIP（用 SYNC_TOKEN 鉴权）
curl -O -J http://backend.example.com:3000/api/admin/sync/export \
     -H "Authorization: Bearer $SYNC_TOKEN"
```

---

## 常见问题（排查清单）

### ❶ 浏览器 ERR_CONNECTION_REFUSED / 拒绝连接

按下面顺序排：

1. **端口映射写错**：镜像内监听 3000，所以 `-p 80:3000`、不是 `80:80`。
2. **容器其实退了**：`docker compose ps` 看 `app` 是不是 `Exited`；`docker compose logs app` 看错误。
   - 最常见报错：`Validation Error Count: 1 [Context: getConfig]` → `.env` 漏填 `DATABASE_URL` / `AUTH_SECRET` / `ENCRYPTION_KEY`。
3. **防火墙 / 安全组**：阿里云、腾讯云、DigitalOcean 控制台放行 80 / 3000 入站。
4. **前端的 backend 入口写成了 localhost**：跨服务器时必须填 backend 的公网 IP / 域名，frontend 容器内的 localhost 是它自己。

### ❷ 前端没有文章

1. `/admin/sync` 看「上次同步」、「上次错误」字段。
2. backend 上必须有 `status=PUBLISHED` 的文章；DRAFT 不会导出。
3. backend 入口可达性：`curl -I http://api.example.com:3000/api/health`。
4. `SYNC_TOKEN` 两端对得上吗？前端日志里的 401/403 一般就是它。

### ❸ 401 "未授权：本路由仅允许已配置共享密钥的前端代理调用"

这是 backend 模式正确的行为：所有 `/api/public/*` 都要带 `Authorization: Bearer SYNC_TOKEN`。

- 如果你是从 frontend 调过来的，`/admin/sync` 的密钥就是错的，或没保存就重启过；重新填一次。
- 如果你是从浏览器直接访问 backend 公开页，会被中间件重定向到 `/admin`，这是预期。

### ❹ 视频无法播放

- **外链 / EMBED**：原始 URL 可能限制 iframe，换一个能 embed 的来源。
- **本地视频**：自动同步**默认不带 mp4 文件**（保护小机），需要在后端 `/admin/sync` 下载「全量 ZIP」或「增量 ZIP」，前端手动上传。
- 文件存在但播放失败：浏览器 devtools network 看 `/uploads/...` 的 HTTP 状态。`/uploads/[...path]/route.ts` 自带 Range 支持，断点续播没问题。

### ❺ 内存不足

- 优先**前后端拆分**；前端镜像 < 800 MB，1 GB 机器跑得动。
- 前端坚持用「轻量 ZIP」，本地视频改外链或嵌入。
- 后端 worker 并发保持 1（默认），别贪心。
- 完整版建议 4 GB 起步。

### ❻ 构建非常慢 / OOM

`docker compose up --build` 会下 Playwright/Chromium 并跑 `next build`，2 GB 机器经常 OOM。两个办法：

1. 改用 Docker Hub 上的预构建镜像：删 `--build`，`docker compose pull && up -d` 即可。
2. 用 4 GB+ 的机器构建，`docker push safg/shibei:xxx`，再到目标机器拉。

### ❼ 启动日志 `Unique constraint failed`

旧版本 seed 按单字段唯一写默认主题/模块，升级时遇到 `name` 或 `slug` 冲突。当前版本已按 `slug or name` 识别已有数据，重建镜像 + 重启即可。

### ❽ 80 端口被别的服务占用

编辑对应 compose，删掉 `"80:3000"` 一行，前置 Caddy/Nginx 反代做端口转发与 TLS。

---

## 安全建议

- **改默认密码**：`.env.example` 里的 `change-me-now` 仅适合首次启动，登录后立刻去 `/admin/settings/admin` 改成强密码。
- **AUTH_SECRET / ENCRYPTION_KEY**：每个部署独立，长度 ≥ 32 byte 随机串。
- **SYNC_TOKEN**：跨服务器场景务必 HTTPS，定期轮换；轮换时先在两端同步保存新值再删旧值。
- **公开 backend**：`backend` 模式下 `/api/public/*` 已要求 SYNC_TOKEN；但建议再加一层 Caddy/Nginx 限速，避开未授权扫描的恶意请求。
- **API Key**：所有外部 API Key（OpenAI / DeepSeek / Exa）都用 `ENCRYPTION_KEY` 加密入库；备份数据库等同备份这些密钥，注意 ACL。
- **上传体积限制**：音乐 30 MB、视频 300 MB、ZIP 同步 512 MB，按需在源码改大但记得给反代也加 `client_max_body_size`。

---

## 升级到新版本

```bash
cd /opt/ShellPick
git pull
docker compose pull          # 拉最新预构建镜像；或 docker compose build
docker compose up -d         # 滚动重启；start-app.sh 会自动 migrate deploy + seed
docker compose logs -f app | head -60
```

迁移文件全部带 `IF NOT EXISTS`，重复执行安全。如果你修改了本地代码，看 `docker compose build` 提示的 cache 命中率决定是否要 `--no-cache`。

---

## 许可

MIT License — 自由使用、修改与分发。

> 二次发行时建议保留对原作者与 [SYNC.md](./SYNC.md) 协议的引用，方便后续社区维护同步格式。
