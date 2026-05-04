# 拾贝 信息博客项目说明书

ShiBei 是一个面向个人或小团队的信息整理博客系统。它的核心目标不是单纯写文章，而是把"抓取资料、AI 初步整理、人工审核发布、前台轻量阅读"串成一个完整流程。系统使用 Next.js、Prisma、PostgreSQL、Redis、BullMQ 与 Docker 构建，既可以单机运行，也可以拆成前端应用和后端应用分别部署。前端应用只负责展示文章、展示视频、接收同步数据和提供公开页面；后端应用负责抓取网页/RSS、调用 OpenAI-compatible 模型生成草稿、执行自动整理任务、导出文章 ZIP 包；完整版应用则把两者放在一台服务器中运行。

## 一、系统形态

本项目支持三种部署形态，对应三个独立镜像：

1. **前端应用 `APP_MODE=frontend`**：只运行公开博客、视频展示、管理后台中的文章/视频/同步/设置等轻量功能。它不安装 Playwright、yt-dlp、ffmpeg，也不需要 Redis 和 BullMQ worker。文章来自后端导出的同步包，默认由轻量 `sync-worker` 自动拉取，也可以在后台手动上传 ZIP。视频支持前端手动上传，并可挂载到任意文章。
2. **后端应用 `APP_MODE=backend`**：运行抓取、AI 总结、自动整理、视频识别/下载、文章导出等重型能力。公开访问会被 Next.js 中间件重定向到后台，通常只给管理员或前端服务器访问。后端可以通过 `/admin/sync` 下载 ZIP，也可让前端通过共享密钥自动拉取。
3. **完整版应用 `APP_MODE=full`**：适合只有一台服务器的场景，前台、后台、抓取、队列、同步导入导出都在同一个部署中。它资源占用最高，但配置最简单。

推荐资源规格：前端应用最低 1 核 512MB 可运行，1 核 1GB 更稳；后端应用最低 2 核 2GB；完整版应用最低 2 核 4GB。Docker Compose 已内置较保守的 `NODE_OPTIONS`、Postgres `shared_buffers`、Redis `maxmemory` 与 worker 并发设置，默认优先保证低内存服务器不被大任务压垮。

## 二、Docker 镜像与文件总览

### 2.1 Docker Hub 预构建镜像

项目镜像已托管在 Docker Hub，**无需本地编译**就能跑起来：

| Tag | 体积 | 包含组件 | 用途 |
| --- | --- | --- | --- |
| `safg/shibei:frontend` | ~1.12 GB | Node 22-slim + Next.js + 轻量 `sync-worker` | 公开站、低内存前端机 |
| `safg/shibei:backend`  | ~3.15 GB | Node 22 + Playwright/Chromium + yt-dlp + ffmpeg + Next.js + BullMQ worker | 抓取/AI 处理/视频下载 |
| `safg/shibei:full`     | ~3.15 GB | 同 backend，但 `APP_MODE=full`，公开页不重定向 | 单机一体部署 |

镜像主页：<https://hub.docker.com/r/safg/shibei>

```bash
# 无需单独 pull，Compose 的 image: 字段会自动拉取，直接启动即可：

# 完整版
docker compose up -d

# 前端应用
docker compose -f docker-compose.frontend.yml up -d

# 后端应用
docker compose -f docker-compose.backend.yml up -d
```

> 镜像基于 `node:22-bookworm`（前端是 `bookworm-slim`），自带 `fonts-noto-cjk` 中文字体；后端/完整版另外通过 `pip3` 安装了 `yt-dlp>=2024.10.0`，并执行 `playwright install --with-deps chromium`，所以体积明显更大。如果带宽受限，**优先单独拉前端镜像**。

> ⚠️ **不要直接 `docker run safg/shibei:xxx` 启动**
>
> 三个镜像都不是"开箱即用"的单体应用，启动脚本里会执行 `prisma migrate deploy` 和 `npm run db:seed`，**必须先有 PostgreSQL** 并配齐 `DATABASE_URL`、`AUTH_SECRET`、`ENCRYPTION_KEY`、`ADMIN_USERNAME`、`ADMIN_PASSWORD` 等环境变量；前端镜像还需要 `NEXT_PUBLIC_SITE_URL`，后端/完整版还需要 `REDIS_URL`。缺任何一个都会让容器在启动时立刻退出（Prisma 报 `Validation Error … [Context: getConfig]`）。
>
> 此外，**容器内监听的是 3000 端口而不是 80**，所以端口映射必须写成 `-p 80:3000`。
>
> 典型错误示例：
>
> ```bash
> # ❌ 错误：缺 db / env，端口也写错（容器内是 3000）
> docker run -d --name shibei-frontend -p 80:80 safg/shibei:frontend
> # 现象：浏览器报 ERR_CONNECTION_REFUSED，docker logs 显示 Prisma 校验失败
> ```
>
> 推荐做法：直接用仓库里写好的 compose 文件（已经把 Postgres/Redis/端口/env 全部串好），然后只需修改 `.env`：
>
> ```bash
> cp .env.example .env             # 修改 AUTH_SECRET、ENCRYPTION_KEY、ADMIN_PASSWORD…
> docker compose -f docker-compose.frontend.yml up -d
> ```

### 2.2 仓库内 Dockerfile

| 文件 | `APP_MODE` | 内存默认值 | 说明 |
| --- | --- | --- | --- |
| `Dockerfile`          | `full`     | `--max-old-space-size=1024` | 构建完整版镜像，包含全部抓取依赖 |
| `Dockerfile.backend`  | `backend`  | `--max-old-space-size=768`  | 与完整版同源；中间件会把公开路由重定向到 `/admin` |
| `Dockerfile.frontend` | `frontend` | `--max-old-space-size=256`  | 跳过 Playwright 浏览器下载，不安装 yt-dlp/ffmpeg/python3 |

三个 Dockerfile 都是 multi-stage 构建（`base → deps → builder → runner`），运行命令统一是 `sh scripts/start-app.sh`，启动脚本会按 `APP_MODE` 决定是否启用 `sync-worker`、是否跑迁移与 seed。

### 2.3 仓库内 Compose 文件

| 文件 | 服务组合 | 适用场景 |
| --- | --- | --- |
| `docker-compose.yml`           | postgres + redis + app + worker（均使用 `Dockerfile`） | 单机完整版 |
| `docker-compose.backend.yml`   | postgres + redis + app + worker（均使用 `Dockerfile.backend`） | 后端独立服务器 |
| `docker-compose.frontend.yml`  | postgres + app（使用 `Dockerfile.frontend`，进程内并发跑 `sync-worker`） | 前端独立服务器 |
| `docker-compose.frontdemo.yml` | 仅前端（接入既有 backend 的 docker 网络） | 同机演示前后端拆分 |

> 前端模式不需要 Redis 与单独的 BullMQ worker；后端 `app` 容器和 `worker` 容器使用同一个镜像，但 `worker` 容器不监听 HTTP，只跑 `npm run worker`。

## 三、首次启动

### 3.1 准备环境变量

```bash
cp .env.example .env
```

至少修改以下内容：

```env
AUTH_SECRET="换成足够长的随机字符串"
ENCRYPTION_KEY="换成足够长的随机字符串"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="首次登录密码"
NEXT_PUBLIC_SITE_URL="http://服务器IP:3000"
```

`DATABASE_URL` / `REDIS_URL` 已经默认指向 compose 中的 `postgres` / `redis` 服务名，单机部署不需要改。`BACKEND_API_URL`、`SYNC_TOKEN` 这些在前后端拆分时再填，**也可以启动后在 `/admin/sync` 网页端保存**，不必改环境变量后重新构建。

### 3.2 启动方式（本地构建）

```bash
# 完整版
docker compose up --build -d

# 前端应用
docker compose -f docker-compose.frontend.yml up --build -d

# 后端应用
docker compose -f docker-compose.backend.yml up --build -d
```

### 3.3 启动方式（直接使用 Docker Hub 预构建镜像）

Compose 文件已配置 `image: safg/shibei:xxx`，启动时会自动拉取镜像，不需要本机构建：

然后运行：

```bash
docker compose pull            # 拉最新镜像
docker compose up -d           # 跳过 --build
```

### 3.4 访问地址

```text
http://服务器IP:3000          # 公开站
http://服务器IP:3000/admin    # 管理后台
```

完整版与前端 Compose 同时映射了 `80:3000`，开放 80 端口的服务器可以直接访问 `http://服务器IP`。后端 Compose 只暴露 `3000:3000`，建议绑定到内网或反代后再开放。

### 3.5 端口、卷、资源限制速查

| 服务 | 默认端口（host:container） | 命名卷 | `mem_limit` |
| --- | --- | --- | --- |
| `app`（full）         | `80:3000`、`3000:3000` | `app-uploads → /app/public/uploads` | 1024 MB |
| `worker`（full）      | — | `app-uploads → /app/public/uploads` | 1536 MB |
| `app`（backend）      | `3000:3000` | `app-uploads → /app/public/uploads` | 768 MB  |
| `worker`（backend）   | — | `app-uploads → /app/public/uploads` | 1024 MB |
| `app`（frontend）     | `80:3000`、`3000:3000` | `app-uploads → /app/public/uploads` | 320 MB  |
| `postgres` (full/backend) | — | `postgres-data → /var/lib/postgresql/data` | 384–512 MB |
| `postgres` (frontend) | — | `postgres-data → /var/lib/postgresql/data` | 128 MB  |
| `redis` (full/backend) | — | `redis-data → /data` | 192–256 MB |

`app-uploads` 卷在所有部署形态下都对应 `/app/public/uploads`，存放视频、音乐与同步导入的素材。卸载部署时若执行 `docker compose down -v` 会**一并删除该卷**，请提前备份。

## 四、前后端两台服务器同步

两台服务器的配置尽量放到了网页端：

1. **后端**先启动，登录 `/admin/sync`，生成并保存一串 `SYNC_TOKEN`（共享密钥）。
2. **前端**启动后，登录 `/admin/sync`，填写后端入口（如 `http://后端服务器IP:3000`）和**同一串** `SYNC_TOKEN`。
3. 同步模式默认是自动拉取，前端轻量 `sync-worker` 会按 `SYNC_INTERVAL_MINUTES`（默认 15 分钟）读取数据库/环境变量配置，因此即使容器启动时还没有填后端地址，后续在网页端保存后也会自动开始工作，不需要重新构建镜像。

自动同步**默认只拉取文章、标签、文章与视频的元数据，不拉取本地视频文件**——这是为了保护 512MB/1GB 的前端服务器，避免大 ZIP 在内存中解压造成进程退出。需要把后端本地视频文件带到前端时，可以在后端 `/admin/sync` 下载"全量 ZIP"或"增量 ZIP"，这两个按钮会包含本地视频文件，然后到前端 `/admin/sync` 手动上传。也可以下载"轻量 ZIP"，它只包含文章与视频链接信息。

> 同机演示前后端拆分可参考 `docker-compose.frontdemo.yml`：它会另起一个独立的 PostgreSQL + 前端容器，通过 docker 外部网络 `video_default` 接入既有 backend 容器的服务名 `app`，这样 `BACKEND_API_URL` 直接写 `http://app:3000` 即可。

## 五、文章与视频工作流

后端后台配置模型、信息源和总结风格后，可以运行抓取任务。系统会抓取网页或 RSS，生成原始材料，再调用模型输出 Markdown 草稿。管理员在 `/admin/posts` 审核、编辑并发布后，文章会进入可同步范围。**只有 `PUBLISHED` 状态的文章会被导出给前端。**

视频有三种形式：本地上传、嵌入链接、普通外链。前端应用也可以直接上传视频，不依赖后端。进入文章编辑页后，可以上传新视频并自动挂载到该文章，也可以把已有视频挂载到当前文章。每个视频都有一个短代码，例如：

```markdown
[[video:VIDEO_ID]]
```

把短代码放在 Markdown 正文任意位置，公开文章页就会在该位置展示播放器。已经被短代码插入的视频不会在文章末尾重复出现；没有被短代码引用但挂载到文章的视频，会在文章末尾"相关视频"区域展示。

## 六、后台主要功能

后台 `/admin/settings` 用于站点名称、简介、主题、字体、默认语言、AI 模型、Exa、存储清理策略等配置。API Key 会加密存储，不会明文回显。`/admin/sources` 用于添加网页 URL、RSS 或视频资源；`/admin/auto-curation` 用于配置主题、关键词和自动整理；`/admin/videos` 用于集中管理视频；`/admin/sync` 用于前后端同步配置、ZIP 导入导出和同步状态查看。

前端模式下会自动隐藏或屏蔽后端专用功能，例如信息源管理、模型配置新增、自动整理和抓取运行接口。这样前端服务器不需要 Redis、浏览器抓取环境和视频下载工具，部署体积与内存占用都更低。

## 七、资源占用与维护建议

- **前端应用**使用 `Dockerfile.frontend`，跳过 Playwright 浏览器下载，不安装 yt-dlp、ffmpeg、python3，Compose 只包含 Postgres 与 app 容器。默认 app 内存限制 320MB、Postgres 128MB，适合 512MB 到 1GB 的小服务器。建议前端少量使用本地视频，更多采用外链或嵌入视频。
- **后端应用**使用 `Dockerfile.backend`，包含 Playwright、Chromium、yt-dlp 和 ffmpeg，因此镜像更大。默认 worker 并发为 1，适合 2 核 2GB 起步。如果服务器更强，可以通过 `FETCH_WORKER_CONCURRENCY`、`RESEARCH_WORKER_CONCURRENCY`、`AUDIENCE_WORKER_CONCURRENCY`、`SCHEDULE_WORKER_CONCURRENCY` 等环境变量提高并发。
- **完整版应用**适合 2 核 4GB 起步。它同时运行 Next.js、worker、Postgres、Redis 和浏览器抓取环境。如果经常处理视频或大网页，建议给更多内存，或者改为前后端拆分。

### 常用运维命令

```bash
# 查看运行状态
docker compose ps

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
```

## 八、常见问题

- **浏览器访问"拒绝连接 / connection refused"**：先排除两个最常见的原因。
  1. **端口映射写错**：镜像内服务监听 `3000` 端口，所以宿主机 80 要映射的是容器的 3000，命令行参数应是 `-p 80:3000`，compose 里写 `"80:3000"`；写成 `80:80` 时宿主机 80 没人接听，必然 refused。
  2. **容器其实已经退出**：执行 `docker compose ps` 或 `docker ps -a`，如果 `app` 是 `Exited` 状态，再跑 `docker compose logs app` / `docker logs <容器名>` 看错误。最常见的报错是 `Validation Error Count: 1 [Context: getConfig]`——这是 Prisma 校验失败，说明 `DATABASE_URL` 没配或者数据库还没起来；把 `.env` 里的 `DATABASE_URL`、`AUTH_SECRET`、`ENCRYPTION_KEY` 等填齐，并改用 compose（自带 postgres 服务）即可。
  3. 如果以上都没问题但公网仍 refused，再看服务器防火墙 / 云厂商安全组（DigitalOcean、阿里云、腾讯云控制台）是否放行了 80 端口入站。
- **前端没有文章**：先检查 `/admin/sync` 中 backend 入口、`SYNC_TOKEN` 和同步模式是否正确。后端必须有已发布文章，草稿不会导出。如果自动同步失败，页面会显示上次错误，也可以查看 app 容器日志。
- **视频无法播放**：先确认视频类型。外链视频只能跳转，嵌入视频必须是允许 iframe 的平台地址，本地视频必须存在于 `/public/uploads/video`。自动同步不会默认携带本地视频文件，需要手动下载包含文件的 ZIP。
- **内存不足**：优先使用前后端拆分；前端使用轻量 ZIP，减少本地视频；后端保持 worker 并发为 1；完整版服务器建议升级到 4GB 以上。
- **构建非常慢/失败**：在低内存机上 `docker compose up --build` 可能因 Playwright/Chromium 下载或 `next build` OOM 失败。建议改用 Docker Hub 镜像（`image: safg/shibei:xxx`），跳过本地构建。
- **80 端口被占用**：编辑对应 compose 文件，删掉 `"80:3000"` 这一行只保留 `"3000:3000"`，再前置一个反代（Nginx/Caddy）做 TLS 与端口转发即可。
