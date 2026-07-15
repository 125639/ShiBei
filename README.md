# 拾贝 ShiBei — 信息整理博客系统

> **一个把"抓取资料 → AI 整理 → 人工审核 → 前台轻量阅读"串成一条流水线的个人/小团队博客。**
> 既能单机一体，也能拆成前端 + 后端两台服务器分别部署。

[![Node](https://img.shields.io/badge/node-22--bookworm-43853d?logo=node.js)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.x-black?logo=next.js)](https://nextjs.org/)
[![Postgres](https://img.shields.io/badge/Postgres-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#许可)

---

## 目录

- [项目特点](#项目特点)
- [三种部署形态](#三种部署形态)
- [快速上手](#快速上手docker)
- [跨服务器部署（公网）](#跨服务器部署公网)
- [AI 模型接入](#ai-模型接入)
- [图片自动搜索与手动上传](#图片自动搜索与手动上传)
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
- **可检索列表**：公开文章 / 视频支持搜索、筛选与分页；后台文章列表支持按标题、摘要、标签和状态快速定位。

### 业务逻辑

- **共创工作室（`/create`）**：读者与 AI 访谈式共创。选题材即定评分标尺（维度/权重/公开阈值挂在题材上，时评重时效、教程重实效、个人叙事用情感真实度+细节具体性替代严谨性）；AI 逐题访谈，只问「具体的句子」不问「抽象的意图」，短评 3 问、完整文章 8-10 问；两种成文模式（读者的话为主 / AI 整合为主）；生成的是**可编辑草稿**，默认私有，AI 按标尺加权评分（S=Σwᵢ·scoreᵢ）达阈值且逐维给出具体修改反馈后，由创作者本人主动点击才公开到 `/community`。导出/删除权完全归创作者；未登录也可创作（单 IP 限生成 2 篇、发布后不可删），邮箱注册（`/account`）后不限量且可随时删除。每日 AI 额度由 `AI_CREATION_DAILY_LIMIT` 控制。
- **AI 全局提示词前缀**：`SiteSettings.globalPromptPrefix`，自动加到每次 AI 请求的 system 之前，便于统一调教语气。
- **内容风格可配置**：`/admin/settings` 可创建 `ContentStyle`，选择报道、深度分析、科普解读、教程指南、观点评论、周报/合集、随笔专栏等体裁，并叠加自定义提示词；自动主题、临时抓取、关键词生成都能选用不同风格。
- **自动内容生产调度**：管理员可定义主题、关键词、cron 时间表、生成数量，系统会按计划运行资料搜索与内容生成任务，自动发布开关与发布时间点都可控。
- **信息源 + 视频源相辅相成**：抓页面时同时识别 `<video>` / 视频链接，按 host 区分国内/国外：
  - 国外视频：保留 EMBED 或 LINK，无版权下载风险。
  - 国内视频（B 站、微博、爱奇艺、优酷、腾讯视频、抖音等）：尝试用 `yt-dlp` 下载，**单文章最多 1 个，限时长 ≤ 20 分钟**；每个视频都附带「来源页 + 原始链接 + 平台 + 版权说明」。
- **自动配图 + 手动图片上传**：开启「自动搜索并插入相关图片」后，worker 会从来源页/证据页抓取候选图，按尺寸、位置、alt 关键词、追踪域名等规则筛选，缓存到 `/public/uploads/image/` 后插入正文；管理员也可在新建文章或编辑文章时手动上传 JPG/PNG/WebP/GIF（≤8 MB），选择插入位置并填写图片来源。
- **信息源模块化**：`SourceModule` 表，源可关联多个模块（AI / 财经 / 娱乐 …），主题抓取时只用关联模块的源，效率与相关性更高；管理员还可启用 [Exa](https://exa.ai) 作为额外检索引擎。
- **音乐**：`/admin/music` 上传 MP3/M4A/OGG/WAV（≤30 MB），用户在 `/settings` 启用并选曲，全站浮动播放器（折叠/换曲/音量/关闭）。
- **多语言**：默认中文；管理员可选「双语模式」或「默认语种模式」。在默认语种模式下，用户切到英文时打开文章会调 AI 自动翻译并写入缓存（`titleEn` / `summaryEn` / `contentEn`），下次复用。
- **AI 助手**：博客主页 + 文章页内嵌 `AiAssistant`，模型由管理员在 `/admin/settings` 配置；用户可与 AI 探讨页面文章内容，公开 AI 接口内置限流。
- **用户写作工作台**：`/write` 提供独立写作区，**不计入博客内容**，用户写完可下载保存。AI 辅助使用管理员预设的「写作模型」；用户也可填入自己的 baseUrl / apiKey / model 走自定义模型。
- **SEO / 订阅**：文章与视频详情页生成 canonical / Open Graph metadata，并提供 `/sitemap.xml`、`/robots.txt`、`/feed.xml`。

### 数据访问层

- **存储管理**：`SiteSettings` 内置 `maxStorageMb` / `cleanupAfterDays` / `cleanupCustomEnabled`。`cleanupCustomEnabled` 是后台自动清理的总开关；关闭时定时任务不写库、不删文件。手动强制清理不受该开关影响，但必须在后台阅读影响范围并二次确认。
- **纯文本模式**：开启后抓取不附加视频文件；自动图片搜索仍可在后台设置中单独关闭，进一步省空间。
- **定期清理**：开启自动清理后，worker 每 6 小时按 `cleanupAfterDays` 删除超期的“已完成、非 AI 批次” FetchJob 与孤儿 RawItem；失败/运行中/排队中任务和 AI 管理员批次审计链保留。空间超限时旧文章自动归档（不删正文），并回收超过保留期的已归档文章本地视频。管理员也可二次确认后手动强制执行；手动模式即使空间未超限也会归档超过保留期的已发布文章并删除对应本地视频文件。

### 性能

- 站点主题、字体、语言、名称与描述走 `unstable_cache`（60s + tag-based revalidation），管理员保存时立即刷新。
- `next.config.ts`：`/_next/static/*` 1 年 immutable，`/uploads/*` 1 小时缓存；启用 compress；`optimizePackageImports`。
- 文章 / 视频变更会刷新公开首页、列表、详情、统计、RSS 与 sitemap；公开统计接口带 60s 缓存。

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

### 🚀 一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/125639/ShiBei/main/scripts/bootstrap.sh | bash
```

`bootstrap.sh` 会做三件事：

1. 检查 `git` / `openssl` / `docker` 是否就绪
2. `git clone` 仓库到 `~/ShiBei`（已存在则 `git pull`）
3. 自动运行 `scripts/init.sh` 进入交互式向导

向导会自动：

- 检测公网 IP，默认使用 HTTPS；完整版可为域名或公网 IPv4 自动签发证书
- 用 `openssl rand -hex 32` 生成 `AUTH_SECRET` / `ENCRYPTION_KEY` / `SYNC_TOKEN`
- 留空管理员密码时自动生成 16 位强密码
- 让你选 `full` / `backend` / `frontend` 三种部署形态
- 可选地预设 AI 模型（CanopyWave / OpenAI / DeepSeek / Moonshot / Qwen / SiliconFlow / OpenRouter / 自定义），首次 `db:seed` 落库
- 完整版自动启用 Nginx、Let’s Encrypt 与 systemd 续期 timer；应用端口只绑定回环地址

向导结束会打印对应模式的 `docker compose ... up -d` 命令、健康检查 URL 和登录账号。

> **环境变量覆盖**：`SHIBEI_REPO`（默认仓库）、`SHIBEI_BRANCH`（默认 `main`）、`SHIBEI_DIR`（默认 `~/ShiBei`）、`NO_COLOR=1` 关闭 ANSI 颜色。

### 已经克隆过仓库？直接运行向导

```bash
cd /opt/ShiBei   # 或你的工作目录
bash scripts/init.sh
```

### 不想用向导？走传统流程

```bash
git clone https://github.com/125639/ShiBei.git
cd ShiBei
cp .env.example .env
# 编辑 .env：AUTH_SECRET / ENCRYPTION_KEY / ADMIN_PASSWORD / NEXT_PUBLIC_SITE_URL
# 公网生产环境必须使用 HTTPS；full 模式还要填写 PUBLIC_HOST
# 两个密钥建议各自 `openssl rand -hex 32`
```

### 启动

| 形态 | 启动命令 |
| --- | --- |
| 完整版 | `docker compose up -d && sudo scripts/bootstrap-ip-tls.sh` |
| 后端 | `docker compose -f docker-compose.backend.yml up -d` |
| 前端 | `docker compose -f docker-compose.frontend.yml up -d` |

> Compose 文件里同时保留了 `image:`（拉 Docker Hub 镜像）和 `build:`（本地构建）。
>
> - 默认 `up -d` 会拉 Docker Hub 上的镜像，**几分钟**就能起来。
> - 加 `--build` 会强制本地构建：低内存机器上 Playwright/Chromium 下载 + `next build` 容易 OOM，建议在 4 GB+ 的机器上构建并推到 Docker Hub。

### 访问

```text
https://服务器IP或域名/            # 公开站（完整版）
https://服务器IP或域名/admin       # 管理后台（admin / 向导设置的密码）
https://服务器IP或域名/api/health  # 公开健康检查
```

> 生产身份使用浏览器强制的 `__Host-` + `Secure` Cookie，公网 HTTP 无法安全登录。完整版的向导会自动签发证书、把 HTTP 308 到 HTTPS，并把应用 3000 端口限制在 `127.0.0.1`。证书状态保存在 `/var/lib/shibei-tls`，每天检查两次并在到期前 48 小时 fail loud。
>
> 后端 compose **只暴露 3000**——拆分部署时建议给它套一层 Caddy/Nginx 做 HTTPS。

### 验证

```bash
# 服务状态
docker compose ps

# 健康检查（应返回 {"ok":true,...}）
curl https://你的域名或公网IP/api/health

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

1. **A 服务器（backend）—— 一条命令搞定 .env**

   ```bash
   curl -fsSL https://raw.githubusercontent.com/125639/ShiBei/main/scripts/bootstrap.sh | bash
   # 或在已克隆目录: cd /opt/ShiBei && bash scripts/init.sh
   #
   # 在向导里：
   #   [1/6] 部署模式 → 2 (backend)
   #   [2/6] 站点 URL → https://api.example.com（覆盖默认 IP）
   #   [3/6] 管理员密码 → 留空自动生成
   #   [4/6] 安全密钥 → 自动生成（含 SYNC_TOKEN，向导结束会单独打印）
   #   [5/6] AI 模型 → 选一个并填 API Key（也可跳过到 /admin/settings 配）
   #   [6/6] 确认写入

   docker compose -f docker-compose.backend.yml up -d
   ```

   随后浏览器访问 `https://api.example.com/admin` 登录：

   - `/admin/sources` 添加 RSS / 网页源
   - `/admin/auto-curation` 设置主题与定时调度
   - `/admin/sync` 仅在你想换 SYNC_TOKEN 时再来；向导已经把它写进 `.env` 了

2. **B 服务器（frontend）—— 同样一条命令**

   ```bash
   curl -fsSL https://raw.githubusercontent.com/125639/ShiBei/main/scripts/bootstrap.sh | bash

   # 在向导里：
   #   [1/6] 部署模式 → 3 (frontend)
   #   [2/6] 站点 URL → https://shibei.example.com
   #   [5/6] 同步参数：
   #         Backend 入口 URL → https://api.example.com
   #         同步模式 → auto（默认 15 分钟）
   #   [6/6] 确认写入

   docker compose -f docker-compose.frontend.yml up -d
   ```

   **关键步骤**：把 A 服务器向导生成的 `SYNC_TOKEN` 复制到 B 服务器的 `.env`（直接编辑覆盖即可），或登录 `https://shibei.example.com/admin/sync` 网页端填入并保存。两端 token 必须完全一致。

3. **HTTPS 与反向代理（公网部署必需）**

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

   让 Caddy 监听 80/443，并反代到 `127.0.0.1:3000`；同时把宿主端口绑定为回环地址，不能让公网绕过代理直连。

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

> `scripts/init.sh` 第 5 步可以预选其中之一并填 API Key，首次 `db:seed` 时会自动写入 `ModelConfig`（API Key 用 `ENCRYPTION_KEY` 加密入库）。也可以先跳过、启动后再到 `/admin/settings` 配置。

API Key 会用 `ENCRYPTION_KEY` 派生的 AES-256-GCM 加密后入库；后台仅显示「已配置」，不会回显明文。

### Reasoning 模型（Kimi-k2.6 / DeepSeek-R1 / OpenAI o*）

代码已经针对 reasoning 模型做了两件事：

1. 自动把请求超时拉到 600 秒（普通模型 240 秒），适应思考链时间。
2. 当 `choices[0].message.content` 为 `null` 但 `reasoning_content` 有内容时回退使用 reasoning 文本，避免「Model returned empty content」。

### 模型用途分配

`/admin/settings` 中可以为四类用途分别指定模型，未指定时回退到「默认模型」：

- 内容生成（worker 抓完或搜索完资料后调用）
- 站内 AI 助手
- 用户写作助手
- 翻译（单独缺省时回退到 assistant 模型）

### 内容风格与体裁

后台 `/admin/settings` 的「提示词」页用于管理内容风格：

- **体裁**：报道、深度分析、科普解读、教程指南、观点评论、周报/合集、随笔专栏。
- **风格参数**：语气、篇幅、关注重点、输出结构会统一进入 prompt。
- **自定义提示词**：只控制写法与结构，系统仍会强制保留事实边界：不编造来源外信息，不复制原文，资料不足时明确说明，并在文末保留 `## 参考来源`。
- **使用位置**：自动主题可绑定内容风格；仪表盘和信息源页的临时抓取、关键词生成也可临时选择风格。

公开内容入口是 `/posts` 与 `/posts/:slug`；旧 `/news` 与 `/news/:slug` 会重定向到对应 `/posts` 地址，避免历史链接失效。

---

## 图片自动搜索与手动上传

### 自动搜索并插入相关图片

后台 `/admin/settings` 中的「自动搜索并插入相关图片」控制 worker 是否为自动生成的文章配图：

- **网页抓取**：从原始来源页解析正文图片，缓存到 `/public/uploads/image/`，再以 `<figure class="article-media article-image">` 插入正文导语后。
- **关键词研究 / 每日合集 / 周报**：先从 evidence 里的来源页面二次抓图，再统一走同一套筛选与缓存逻辑。
- **筛选规则**：按图片尺寸、横纵比、所在 DOM 容器、alt 与文章关键词重合度、文件名质量、追踪/像素域名惩罚等综合打分；重复 URL 会规范化去重，缓存过的图片直接复用。
- **安全边界**：远程图片下载会走 URL 安全校验，拒绝内网地址、非图片响应和超过 8 MB 的图片；正文里最终只使用本地 `/uploads/image/...` 路径。

### 管理员手动上传图片

有两个入口：

- `/admin/posts` 新建文章时，可在「正文配图」字段直接上传一张图片，选择插入位置。
- `/admin/posts/:id` 编辑文章时，可在「上传图片并插入正文」区域上传图片，填写图片说明、来源链接，并选择插入到「导语后 / 参考来源前 / 文末」。

手动上传支持 JPG / PNG / WebP / GIF，单文件上限 8 MB。文件按内容 hash 命名，重复上传同一张图片会复用同一个本地文件；插入正文时也会检查同一图片是否已经存在，避免重复挂载。

---

## 本地开发

```bash
# 1) 准备依赖
npm install

# 2) 启 postgres 与 redis（任意方式，这里用 docker 起两个独立容器）
docker run -d --name dev-pg -e POSTGRES_USER=shibei -e POSTGRES_PASSWORD=shibei -e POSTGRES_DB=shibei_blog -p 5432:5432 postgres:16-alpine
docker run -d --name dev-redis -p 6379:6379 redis:7-alpine

# 3) 准备 .env（两种方式任选）
#    a) 推荐：跑一遍向导，会自动生成密钥
bash scripts/init.sh
#    b) 手动：cp .env.example .env 并把 DATABASE_URL 改为 postgresql://shibei:shibei@127.0.0.1:5432/...

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
npm run typecheck         # 静态类型检查
npm run build             # 生产构建（含 prisma generate）
npm run lint              # ESLint
npm run check             # lint + typecheck
bash tests/run-all.sh     # 单元测试 / 集成测试 / 图片缓存与挂载测试
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
ShiBei/
├── prisma/
│   ├── schema.prisma                # 数据模型（Post / Video / Music / Source / SourceModule / ContentTopic / ContentStyle …）
│   ├── seed.ts                      # 初始管理员、默认内容风格、默认主题/模块；读 INIT_AI_* 写入默认模型
│   └── migrations/                  # 13 份 SQL 迁移
├── src/
│   ├── middleware.ts                # APP_MODE 路由守卫；frontend 屏蔽抓取相关路径，backend 把公开页重定向到 /admin
│   ├── app/
│   │   ├── (public)/                # 公开页：/、/posts、/videos、/stats、/settings、/about、/write（/news 兼容重定向）
│   │   ├── admin/                   # 管理后台：dashboard、内容、信息源、模块、主题、模型、音乐、视频、同步…
│   │   ├── api/                     # 路由；admin/* 需 session，public/* 公开（backend 模式带 SYNC_TOKEN 校验）
│   │   ├── uploads/[...path]/       # 兜底服务运行时新写入的视频 / 音乐文件（Range 支持）
│   │   └── layout.tsx               # 站点根布局（主题/字体/语言/UI 选择落到 <html data-*>）
│   ├── components/                  # 复用 UI：AdminShell / PublicShell / AiAssistant / Charts / MusicPlayer …
│   ├── lib/
│   │   ├── ai.ts                    # OpenAI-compat 调用封装 + 内容体裁 prompt 组装
│   │   ├── content-style.ts         # 内容体裁枚举、标签与校验
│   │   ├── article-images.ts        # 自动配图筛选、缓存挂载、手动图片上传与正文插入
│   │   ├── article-image-cache.ts   # 远程图片安全下载、类型/大小校验、本地缓存
│   │   ├── app-mode.ts              # APP_MODE 读取与同步配置默认值
│   │   ├── sync/                    # ZIP 导出 / 导入 / 自动拉取 / 透明代理 / 共享密钥校验
│   │   ├── scrape.ts / scrape-audience.ts  # Playwright 抓页面（仅 backend / full）
│   │   ├── exa.ts                   # Exa 搜索接入
│   │   ├── stats.ts                 # /stats 数据聚合
│   │   ├── storage.ts               # 上传根目录 + 定期清理
│   │   └── …
│   ├── worker/index.ts              # BullMQ worker：fetch / research / digest / audience / schedule（仅 backend / full）
│   └── sync-worker/index.ts         # frontend 专用轻量 sync-worker（仅 frontend）
├── scripts/
│   ├── bootstrap.sh                 # 远程一键安装（curl … | bash）：装依赖检查 → git clone → init.sh
│   ├── init.sh                      # 交互式 .env 向导（自动检测 IP、生成密钥、选模式与 AI 模型）
│   ├── start-app.sh                 # APP_MODE 调度的容器入口（迁移 + seed + 启动）
│   └── apply-migration.mjs          # 手工应用 SQL 的辅助脚本
├── Dockerfile                       # 完整版镜像（Playwright + yt-dlp + ffmpeg）
├── Dockerfile.backend               # 后端镜像，与完整版同源，APP_MODE=backend
├── Dockerfile.frontend              # 前端镜像（slim 基础，无 Chromium / yt-dlp，体积小一半）
├── docker-compose.yml               # 完整版（postgres + redis + app + worker）
├── docker-compose.backend.yml       # 后端（postgres + redis + app + worker，APP_MODE=backend）
├── docker-compose.frontend.yml      # 前端（postgres + app，sync-worker 在容器内并发跑）
├── docker-compose.frontdemo.yml     # 演示前端接入既有 backend 的 docker 网络
├── .env.example                     # 必填环境变量样板（手动模式参考）
├── README.md                        # 本文件
├── SYNC.md                          # 同步协议详细规格
└── DEPLOY_NOTES.md                  # 部署历史记录与变更说明
```

### 数据流（backend → frontend）

```text
1. backend.worker 抓 RSS / 网页 → RawItem（原始）
2. backend.worker 按 ContentStyle 调 AI → Post（DRAFT / PUBLISHED）+ 自动配图缓存 + Video metadata
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
# 重新跑向导（会先备份现有 .env）
bash scripts/init.sh

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
curl https://服务器域名/api/health
docker compose exec app sh -c 'echo $APP_MODE'

# backend 立即生成 ZIP（用 SYNC_TOKEN 鉴权）
curl -O -J https://backend.example.com/api/admin/sync/export \
     -H "Authorization: Bearer $SYNC_TOKEN"
```

---

## 常见问题（排查清单）

### ❶ 浏览器 ERR_CONNECTION_REFUSED / 拒绝连接

按下面顺序排：

1. **HTTPS 入口没启动**：完整版运行 `sudo scripts/bootstrap-ip-tls.sh`，再看 `docker compose --profile https ps proxy` 与 `systemctl status shibei-tls-renew.timer`。
2. **容器其实退了**：`docker compose ps` 看 `app` 是不是 `Exited`；`docker compose logs app` 看错误。
   - 最常见报错：`Validation Error Count: 1 [Context: getConfig]` → `.env` 漏填 `DATABASE_URL` / `AUTH_SECRET` / `ENCRYPTION_KEY`。重跑 `bash scripts/init.sh` 即可一次性补齐。
3. **防火墙 / 安全组**：公网只放行 80/443；不要放行 3000，避免绕过 TLS 与可信代理边界。
4. **前端的 backend 入口写成了 localhost**：跨服务器时必须填 backend 的公网 IP / 域名，frontend 容器内的 localhost 是它自己。

### ❷ 前端没有文章

1. `/admin/sync` 看「上次同步」、「上次错误」字段。
2. backend 上必须有 `status=PUBLISHED` 的文章；DRAFT 不会导出。
3. backend 入口可达性：`curl -I https://api.example.com/api/health`。
4. `SYNC_TOKEN` 两端对得上吗？前端日志里的 401/403 一般就是它。

### ❸ 401 "未授权：本路由仅允许已配置共享密钥的前端代理调用"

这是 backend 模式正确的行为：所有 `/api/public/*` 都要带 `Authorization: Bearer SYNC_TOKEN`。

- 如果你是从 frontend 调过来的，`/admin/sync` 的密钥就是错的，或没保存就重启过；重新填一次。
- 如果你是从浏览器直接访问 backend 公开页，会被中间件重定向到 `/admin`，这是预期。

### ❹ 视频无法播放

- **外链 / EMBED**：原始 URL 可能限制 iframe，换一个能 embed 的来源。
- **本地视频**：自动同步**默认不带 mp4 文件**（保护小机），需要在后端 `/admin/sync` 下载「全量 ZIP」或「增量 ZIP」，前端手动上传。
- 文件存在但播放失败：浏览器 devtools network 看 `/uploads/...` 的 HTTP 状态。`/uploads/[...path]/route.ts` 自带 Range 支持，断点续播没问题。

### ❺ 图片没有自动插入 / 手动上传后不显示

- 后台 `/admin/settings` 里的「自动搜索并插入相关图片」是否关闭了；关闭后 worker 不会为自动文章配图。
- 自动流程只会插入打分合格的图片。来源页如果只有 logo、头像、二维码、广告图、像素追踪图，系统会主动跳过。
- 手动上传只支持 JPG / PNG / WebP / GIF，单文件上限 8 MB；文件会写到 `/public/uploads/image/`。
- 文件存在但前台不显示：浏览器 devtools network 看 `/uploads/image/...` 的 HTTP 状态。运行时新增文件由 `/uploads/[...path]/route.ts` 兜底服务，正常应返回对应 `image/*` Content-Type。

### ❻ 内存不足

- 优先**前后端拆分**；前端镜像 < 800 MB，1 GB 机器跑得动。
- 前端坚持用「轻量 ZIP」，本地视频改外链或嵌入。
- 后端 worker 并发保持 1（默认），别贪心。
- 完整版建议 4 GB 起步。

### ❼ 构建非常慢 / OOM

`docker compose up --build` 会下 Playwright/Chromium 并跑 `next build`，2 GB 机器经常 OOM。两个办法：

1. 改用 Docker Hub 上的预构建镜像：删 `--build`，`docker compose pull && up -d` 即可。
2. 用 4 GB+ 的机器构建，`docker push safg/shibei:xxx`，再到目标机器拉。

### ❽ 启动日志 `Unique constraint failed`

旧版本 seed 按单字段唯一写默认主题/模块，升级时遇到 `name` 或 `slug` 冲突。当前版本已按 `slug or name` 识别已有数据，重建镜像 + 重启即可。

### ❾ 想用 80/443 访问

完整版填写 `NEXT_PUBLIC_SITE_URL=https://域名或公网IP` 与 `PUBLIC_HOST` 后运行 `sudo scripts/bootstrap-ip-tls.sh`。脚本会签发证书、启动 80/443 代理并安装续期 timer；3000 保持只在本机可达。已有 Caddy/Nginx 的拆分部署也必须遵守同一原则。

### ❿ 想换密钥 / 换部署形态

直接重跑向导：

```bash
bash scripts/init.sh
# 检测到旧 .env 时会先备份成 .env.bak.YYYYMMDD-HHMMSS 再覆盖
```

> ⚠️ 改 `ENCRYPTION_KEY` 会让数据库里已加密的 AI Key 全部失效，需要在 `/admin/settings` 重填一次。

---

## 安全建议

- **改默认密码**：向导留空时会自动生成 16 位强密码，登录后仍建议到 `/admin/settings/admin` 改成自己记得住的强密码。
- **AUTH_SECRET / ENCRYPTION_KEY**：每个部署独立，长度 ≥ 32 byte 随机串（向导默认 64 hex）。
- **SYNC_TOKEN**：跨服务器场景务必 HTTPS，定期轮换；轮换时先在两端同步保存新值再删旧值。
- **公开 backend**：`backend` 模式下 `/api/public/*` 已要求 SYNC_TOKEN；但建议再加一层 Caddy/Nginx 限速，避开未授权扫描的恶意请求。
- **AI 接口限流**：助手、翻译、写作辅助默认按客户端 IP 限流；配置 `REDIS_URL` 时跨进程共享计数，否则使用进程内兜底计数。
- **代理 IP 边界**：生产启动器会覆盖内部客户端 IP，默认忽略外部传入的 `X-Real-IP` / `X-Forwarded-For`，避免轮换伪造头绕过匿名额度和限流。只有应用端口已被防火墙限制为仅可信反代可访问时，才把 `TRUST_PROXY_HOPS` 设为真实固定代理层数（单层为 `1`）；端口可直连时保持 `0`。
- **抓取目标安全**：网页 / RSS / 图片下载会拒绝 file、localhost、私网 IP、链路本地与云 metadata；真实请求前还会解析 DNS，避免域名解析到内网地址。
- **API Key**：所有外部 API Key（OpenAI / DeepSeek / Exa）都用 `ENCRYPTION_KEY` 加密入库；备份数据库等同备份这些密钥，注意 ACL。
- **上传体积限制**：图片 8 MB、音乐 30 MB、视频 300 MB、ZIP 同步 512 MB，按需在源码改大但记得给反代也加 `client_max_body_size`。

---

## 升级到新版本

```bash
cd /opt/ShiBei
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
