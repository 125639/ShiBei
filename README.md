# 拾贝 信息博客项目说明书

ShiBei 是一个面向个人或小团队的信息整理博客系统。它的核心目标不是单纯写文章，而是把“抓取资料、AI 初步整理、人工审核发布、前台轻量阅读”串成一个完整流程。系统使用 Next.js、Prisma、PostgreSQL、Redis、BullMQ 与 Docker 构建，既可以单机运行，也可以拆成前端应用和后端应用分别部署。前端应用只负责展示文章、展示视频、接收同步数据和提供公开页面；后端应用负责抓取网页/RSS、调用 OpenAI-compatible 模型生成草稿、执行自动整理任务、导出文章 ZIP 包；完整版应用则把两者放在一台服务器中运行。

## 一、系统形态

本项目支持三种部署形态：

1. 前端应用 `APP_MODE=frontend`：只运行公开博客、视频展示、管理后台中的文章/视频/同步/设置等轻量功能。它不安装 Playwright、yt-dlp、ffmpeg，也不需要 Redis 和 BullMQ worker。文章来自后端导出的同步包，默认由轻量 `sync-worker` 自动拉取，也可以在后台手动上传 ZIP。视频支持前端手动上传，并可挂载到任意文章。
2. 后端应用 `APP_MODE=backend`：运行抓取、AI 总结、自动整理、视频识别/下载、文章导出等重型能力。公开访问会被重定向到后台，通常只给管理员或前端服务器访问。后端可以通过 `/admin/sync` 下载 ZIP，也可让前端通过共享密钥自动拉取。
3. 完整版应用 `APP_MODE=full`：适合只有一台服务器的场景，前台、后台、抓取、队列、同步导入导出都在同一个部署中。它资源占用最高，但配置最简单。

推荐资源规格如下：前端应用最低 1 核 512MB 可运行，1 核 1GB 更稳；后端应用最低 2 核 2GB；完整版应用最低 2 核 4GB。Docker Compose 已内置较保守的 `NODE_OPTIONS`、Postgres shared_buffers、Redis maxmemory 与 worker 并发设置，默认优先保证低内存服务器不被大任务压垮。

## 二、首次启动

复制环境变量模板：

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

启动完整版：

```bash
docker compose up --build -d
```

启动前端应用：

```bash
docker compose -f docker-compose.frontend.yml up --build -d
```

启动后端应用：

```bash
docker compose -f docker-compose.backend.yml up --build -d
```

访问地址通常是：

```text
http://服务器IP:3000
http://服务器IP:3000/admin
```

如果服务器开放 80 端口，前端和完整版 Compose 也映射了 `80:3000`，可以直接访问 `http://服务器IP`。

## 三、前后端两台服务器同步

两台服务器的配置尽量放到了网页端。先启动后端，在后端 `/admin/sync` 中保存一串共享密钥；再启动前端，在前端 `/admin/sync` 中填写后端入口，例如 `http://后端服务器IP:3000`，并填写同一串共享密钥。同步模式默认是自动更新，前端轻量 `sync-worker` 会定时读取网页端配置，因此即使容器启动时还没有填后端地址，后续在网页端保存后也会自动开始工作，不需要重新构建镜像。

自动同步默认只拉取文章、标签、文章与视频的元数据，不拉取本地视频文件。这是为了保护 512MB/1GB 的前端服务器，避免大 ZIP 在内存中解压造成进程退出。需要把后端本地视频文件带到前端时，可以在后端 `/admin/sync` 下载“全量 ZIP”或“增量 ZIP”，这两个按钮会包含本地视频文件，然后到前端 `/admin/sync` 手动上传。也可以下载“轻量 ZIP”，它只包含文章与视频链接信息。

## 四、文章与视频工作流

后端后台配置模型、信息源和总结风格后，可以运行抓取任务。系统会抓取网页或 RSS，生成原始材料，再调用模型输出 Markdown 草稿。管理员在 `/admin/posts` 审核、编辑并发布后，文章会进入可同步范围。只有 `PUBLISHED` 状态的文章会被导出给前端。

视频有三种形式：本地上传、嵌入链接、普通外链。前端应用也可以直接上传视频，不依赖后端。进入文章编辑页后，可以上传新视频并自动挂载到该文章，也可以把已有视频挂载到当前文章。每个视频都有一个短代码，例如：

```markdown
[[video:VIDEO_ID]]
```

把短代码放在 Markdown 正文任意位置，公开文章页就会在该位置展示播放器。已经被短代码插入的视频不会在文章末尾重复出现；没有被短代码引用但挂载到文章的视频，会在文章末尾“相关视频”区域展示。

## 五、后台主要功能

后台 `/admin/settings` 用于站点名称、简介、主题、字体、默认语言、AI 模型、Exa、存储清理策略等配置。API Key 会加密存储，不会明文回显。`/admin/sources` 用于添加网页 URL、RSS 或视频资源；`/admin/auto-curation` 用于配置主题、关键词和自动整理；`/admin/videos` 用于集中管理视频；`/admin/sync` 用于前后端同步配置、ZIP 导入导出和同步状态查看。

前端模式下会自动隐藏或屏蔽后端专用功能，例如信息源管理、模型配置新增、自动整理和抓取运行接口。这样前端服务器不需要 Redis、浏览器抓取环境和视频下载工具，部署体积与内存占用都更低。

## 六、资源占用与维护建议

前端应用使用 `Dockerfile.frontend`，跳过 Playwright 浏览器下载，不安装 yt-dlp、ffmpeg、python3，Compose 只包含 Postgres 与 app 容器。默认 app 内存限制为 320MB，Postgres 128MB，适合 512MB 到 1GB 的小服务器。建议前端少量使用本地视频，更多采用外链或嵌入视频。

后端应用使用 `Dockerfile.backend`，包含 Playwright、Chromium、yt-dlp 和 ffmpeg，因此镜像更大。默认 worker 并发为 1，适合 2 核 2GB 起步。如果服务器更强，可以通过 `FETCH_WORKER_CONCURRENCY`、`RESEARCH_WORKER_CONCURRENCY` 等环境变量提高并发。

完整版应用适合 2 核 4GB 起步。它同时运行 Next.js、worker、Postgres、Redis 和浏览器抓取环境。如果经常处理视频或大网页，建议给更多内存，或者改为前后端拆分。

## 七、常见问题

如果前端没有文章，先检查 `/admin/sync` 中 backend 入口、共享密钥和同步模式是否正确。后端必须有已发布文章，草稿不会导出。如果自动同步失败，页面会显示上次错误，也可以查看 app 容器日志。

如果视频无法播放，先确认视频类型。外链视频只能跳转，嵌入视频必须是允许 iframe 的平台地址，本地视频必须存在于 `/public/uploads/video`。自动同步不会默认携带本地视频文件，需要手动下载包含文件的 ZIP。

如果内存不足，优先使用前后端拆分；前端使用轻量 ZIP，减少本地视频；后端保持 worker 并发为 1；完整版服务器建议升级到 4GB 以上。
