# 2026-07-15 HTTP-first 部署边界

拾贝现在按常见自托管应用的分层方式部署：应用层稳定提供 HTTP，域名、TLS 和 80/443 由用户已有的 Nginx、Caddy、Traefik、宝塔或云入口处理。新安装不申请证书，不强制域名，不默认占用 80/443。

## 三种形态的默认入口

| 形态 | Compose | 默认入口 | 外置 TLS |
| --- | --- | --- | --- |
| 完整版 | `docker-compose.yml` | `http://<host>:3000` | 可选，公网建议 |
| 后端 | `docker-compose.backend.yml` | `http://<host>:3000` | 公网同步时必需，私网可省略 |
| 前端 | `docker-compose.frontend.yml` | `http://<host>:3000` | 公网站点必需 |

默认直连 HTTP 配置：

```dotenv
PUBLIC_URL="http://<服务器IP>:3000"
APP_BIND_IP="0.0.0.0"
APP_PORT="3000"
TRUST_PROXY_HOPS="0"
```

可以使用 HTTP 登录，但该模式使用独立的 `shibei_http_*` host-only Cookie，且网络上的密码、Cookie 和内容均为明文。它只适合本机、受信 LAN 或初次验活，不是公网安全方案。

## 公网域名模式

```dotenv
PUBLIC_URL="https://blog.example.com"
APP_BIND_IP="127.0.0.1"
APP_PORT="3000"
TRUST_PROXY_HOPS="1"
```

`PUBLIC_URL` 是运行时配置；更换域名或协议后只需修改 `.env` 并重启应用，不再为 URL 重建镜像。`https://` 模式使用 `Secure` + `__Host-*` Cookie。从 HTTP 切换到 HTTPS 后需要重新登录。

外部反代必须传递 `Host`、`X-Forwarded-Proto` 和 `X-Forwarded-For`。`TRUST_PROXY_HOPS` 必须与客户端到应用之间的固定可信代理层数一致；只有应用端口无法被公网绕过反代直连时才能设为非零。

可直接使用：

- [Nginx 样例](./ops/reverse-proxy/nginx.conf)
- [Caddy 样例](./ops/reverse-proxy/Caddyfile)
- [Traefik 动态配置](./ops/reverse-proxy/traefik-dynamic.yml)
- [完整反代说明](./ops/reverse-proxy/README.md)

## 更新与代理的所有权

一键更新只管理拾贝容器：frontend 更新 `app`，backend/full 更新 `app` 与 `worker`。它不重建、重载或改写用户的反代，不申请/续期证书，不修改 DNS。只要反代的上游保持为 `http://127.0.0.1:${APP_PORT:-3000}`，应用更新就不会破坏入口通信。

## 存量内置 HTTPS 兼容

旧版本的 Compose `proxy`、证书脚本与 TLS systemd 单元暂时作为过渡升级资产保留，避免旧更新器拉取本版后重启入口失败，或因 bind-mount 源被删除而导致 HTTPS 无法恢复。新向导、常规部署脚本和新版更新器均不启用或管理它们。存量实例更新后应迁移到 [外置反向代理](./ops/reverse-proxy/README.md)，验证后再删除旧代理容器和旧续期任务；新部署不要使用这些资产。

存量 `NEXT_PUBLIC_SITE_URL` 可暂时作为运行时兼容值；升级时应将同一起源写入 `PUBLIC_URL`。两者同时存在时以 `PUBLIC_URL` 为准。

---

# 2026-07-09 网页端一键更新（三种形态通用）

GitHub 仓库有新提交时，管理后台**左上角自动弹出提示**（叉掉后同一版本不再弹）；
弹窗或侧栏「系统更新」`/admin/update` 页面里可以一键完成
「git 拉取 → 重建镜像 → 滚动重启」，全程网页操作，无需 SSH。

## 结构

- **updater 伴车容器**（`Dockerfile.updater` + 各 compose 的 `updater` 服务）：
  挂载 `/var/run/docker.sock` 和仓库目录 `.:/repo`，跑 `scripts/updater/server.mjs`。
  只在 compose 内网监听 9080（**不映射端口**——docker.sock 等价宿主 root，绝不可暴露公网）。
  鉴权 Bearer `UPDATER_TOKEN`，未设置时自动复用 `AUTH_SECRET`（app 与 updater 同读 .env，零配置）。
- **app 端**：`/api/admin/update/check|apply|status`（均需管理员登录），`src/lib/update.ts`。
  检查主路径走 updater（git fetch 对比，支持私有仓库、无 API 限额）；
  updater 没起来时降级 GitHub API（`UPDATE_REPO`/`UPDATE_BRANCH`，默认 `125639/ShiBei` main），
  此时只能提示新版本，页面会给出启用 updater 的命令。
- 更新流程固定为：拒绝脏工作区和本地领先提交，`git fetch && git merge --ff-only origin/<branch>` → `docker compose build <services>`；不会强制覆盖服务器文件
  →`up -d --no-deps <services>`，不接受任何请求参数，无注入面；服务器仓库存在未提交改动时更新会直接拒绝执行（不会丢弃任何本地修改）。
  `--no-deps` 保证绝不顺手重建 postgres/redis；外部反代、DNS 与证书不属于 updater 服务清单，不会被重启或改写。
- compose project 名通过容器自身的 `com.docker.compose.project` label 自省获得，
  不会因为挂载路径是 /repo 而落到错误的 project 上。

## 各形态差异（compose 里 updater 服务的环境变量）

| 形态 | COMPOSE_FILE_NAME | UPDATE_BUILD_SERVICES（构建） | UPDATE_SERVICES（重启） |
|---|---|---|---|
| full | docker-compose.yml | app | app worker |
| backend | docker-compose.backend.yml | app | app worker |
| frontend | docker-compose.frontend.yml | app | app |

app 与 worker 共用同一镜像 tag，构建一次 app 即可（与 scripts/deploy.sh 一致），up 时 worker 自动换新镜像。

## 启用（现有部署升级后执行一次）

```bash
cd /root/video   # 仓库目录
git pull
docker compose -f <对应形态的 compose 文件> up -d --build updater
# 之后的应用更新都可以在网页上点了
```

## 注意

- updater **不更新它自己**：某次更新如果改了 `scripts/updater/*` 或 `Dockerfile.updater`，
  更新日志会提示，需再手动执行一次上面的 `up -d --build updater`。
- 更新期间站点中断几十秒（compose up 替换 app 容器）；前端弹窗/更新页会显示
  「应用重启中」并在完成后提示刷新。构建约 3-10 分钟。
- 内存 ≤1GB 的小机（如 frontend 形态的 765MB 机器）本机构建镜像可能吃紧，
  建议配好 swap；构建失败不影响正在运行的旧容器。
- 弹窗的「叉掉不再提醒」记录在浏览器 localStorage（`shibei.update.dismissed`），按远端版本号记忆。

---

# 2026-07-02（三）用户反馈修复：dynamic 白屏 / 设置页排版 / 后台窄屏导航

## 1. 动态流光（dynamic）公开页白屏 —— 根因与修复
- 根因 A（级联）：`:root[data-theme="apple"] body { background: var(--paper) }` 位于文件后段，与 cyber/dynamic 的 body 背景规则同特异性、顺序更后，把它们全部压成白底；dynamic 又给组件设了白字 → 白底白字"白屏"。该规则本身冗余（html 已画纸色底），已删除并留注释防复发。
- 根因 B（覆盖不全）：cyber/dynamic 原本只为自己的设置页写样式，从未接管公开页颜色。现为两者建立**全站颜色令牌覆盖**（--paper/--ink/--accent/--surface/--chart-* 整套 + color-scheme:dark），所有组件（含图表、表单、骨架屏、后台）自然适配。
- 附带修复：SVG 图表坐标轴文字 fill 跟随 var(--ink)（此前深色主题下轴文字是黑色不可读）。

## 2. 设置页排版
- `.settings-shell` 由双栏 auto-fit 改单列 + 分节线：各节内容量差异大（主题 8 卡 vs 语言 2 卡），双栏行首永远无法对齐。
- 选项卡 min-height 统一（112px；风格卡 172px），跨风格切换时几何稳定。
- **删除 Cyber/DynamicSettingsClient 专属设置页**（连同 SettingsPageSwitcher、framer-motion 依赖入口）：所有界面风格共用同一套设置页结构，风格差异只由 data-ui 全局 CSS 承担——"切风格后框大小改变"的最大来源即来自这两套异构页面。

## 3. 后台窄视口导航（≤960px，含浏览器缩放跨过断点）
- 弃用"隐藏抽屉 + 汉堡按钮"（缩放场景下等于导航消失且难发现）。
- 侧边栏改为**常驻 sticky 顶栏**：单行横向滚动、右缘渐隐提示、当前页高亮、全部条目（含返回前台/退出登录）始终可见可达。删除 AdminMobileNavToggle 组件与相关 CSS/JS。

验证：check/tests/build 通过；Playwright 断言 dynamic/cyber 正文与卡片对比度、设置页单列、cyber 下设置页不再变形、风格卡跨风格高度一致（183px）、900px 视口后台顶栏可见（61px 高、13 个条目）。

---

# 2026-07-02（二）界面风格体系 + 移动端 v2 + 外部改动审查

## 界面风格体系（data-ui 扩展为 6 种）

用户可在 `/settings` 选择界面风格，管理员在 `/admin/settings` 设默认值：

- **classic** 经典（默认，基线精修：文章卡 hover 反馈等）
- **glass** 渐变玻璃：光斑背景、毛玻璃卡片、渐变标题文字、光晕 hover；移动端自动降级 backdrop-filter
- **editorial** 杂志编辑：衬线大标题、条目编号（纯 CSS 计数器）、墨色方按钮、细分割线
- **paper** 温暖纸质：固定暖褐色调 + SVG 噪点纹理、衬线标题、柔和投影（暖色不随主题 accent 变化）
- **cyber** / **dynamic**（原有保留）

实现要点：
- 风格注册表统一在 `src/lib/themes.ts`（UI_STYLES / isUiStyleKey），预注水脚本、useUserPrefs、设置页、后台下拉、API 校验全部走它；新增风格只改一处 + CSS。
- 风格与色彩主题（data-theme×8）正交：新风格全部用主题令牌派生颜色，任意组合成立。
- 修复存量 bug：`useUserPrefs.update()` 此前不写 `data-ui`，切风格必须刷新才生效；Cyber/Dynamic 设置客户端卸载时用过期闭包把 data-ui 写回旧值。现在 update() 统一管理，切换即时生效，恢复默认也完整还原全部属性。

## 移动端 v2（globals.css 末尾 Mobile v2 块）

- sticky 页头 ~185px → **81px**：品牌单行 + 单行横向滚动导航（右缘渐隐提示）
- hero 标题字号收敛（clamp 27–40px），CTA 按钮均分整行
- KPI 概览改 3 列小方块（原来逐个 190px 纵向堆叠）
- 卡片撤销强制 min-height、栅格间距收紧、章节节奏压缩
- 筛选表单单列全宽、标签条/主题 tab 横向滚动、分页大触控目标
- fixed 背景在 ≤820px 统一回退 scroll（含 glass）

## 外部（GPT）改动审查结果

保留且认可：AI 三接口每日全局预算、翻译 in-flight 锁、上传流式限长、同步导入流式读取、uploads nosniff + SVG 降级 octet-stream、health 生产不泄露 DB 错误、`npm ci`、迁移 IF NOT EXISTS 幂等、自动采集去重（DB 复查 + BullMQ 稳定 jobId 双保险）、nextRunAt 展示。

修正的三处：
1. **回退 `output: "standalone"`**（next.config + 3 个 Dockerfile + start-app.sh）。原方案在 Docker 中必然故障：standalone server.js 会 `chdir` 导致 ①静态资源目录错位全站 404；②上传写入路径脱离 compose 卷 `/app/public/uploads`（数据丢失且与 worker 分裂）；③Docker 注入的 HOSTNAME 使服务绑定容器主机名，127.0.0.1 健康检查失败。且本项目启动时要跑 prisma migrate + tsx seed，node_modules 无法省，standalone 无收益。保留了 npm ci 与 nosniff。
2. **重写 `upload-stream.ts` 写入路径为 `stream/promises.pipeline`**：原手写循环在 await 间隙出现写流 error（ENOSPC/EACCES/EEXIST）时无监听器，未处理 error 事件会打崩进程；并且 EEXIST 时不再误删他人文件。
3. **翻译链路**：每日预算移到锁内、缓存复查之后（缓存命中与 202 轮询不再烧预算）；重写 `LanguageAwarePost` 加载 effect——原实现把 status 放进依赖且 effect 开头就改它，cleanup 将 cancelled 置真导致**所有响应被丢弃**（翻译永远转圈，刷新才见缓存），GPT 的轮询定时器同样被废。现为单 effect 自驱动轮询（3s，上限 40 次，遵循 Retry-After，卸载清理）；per-IP 限流 12/h → 90/h 以容纳轮询。

## 验证

`npm run check`、`bash tests/run-all.sh`、生产构建全部通过；Playwright 实测：6 风格卡片渲染、glass/editorial 即时切换、cyber→paper 往返（旧闭包 bug 场景）、恢复默认、glass×midnight 组合、AI 助手交互、404、移动端页头 81px，零页面错误。

---

# 2026-07-02 前端优化迭代

## 概要

一次面向公开前端的整体优化：性能、可访问性、SEO、i18n 一致性与 bug 修复。`npm run check`、`tests/run-all.sh`、生产构建与 Playwright 浏览器级验证全部通过。

## 性能
- **首屏 JS -19%**（首页 gzip 198 KB → 161 KB）：`CustomCursor` 重写为原生 rAF 插值实现，framer-motion 从根布局退出主 bundle（现仅 `/settings` 页按需加载）；光标空闲 2 秒自动停帧，并用 matchMedia 守卫（触屏 / reduced-motion 不激活）。
- 公开页外壳迁移到 `(public)/layout.tsx`：导航/页脚跨路由持久挂载，站点设置查询不再逐页重复。
- 新增 `(public)/loading.tsx` 骨架屏：所有公开页均 force-dynamic，导航期不再白屏。
- 正文图片自动注入 `loading="lazy" decoding="async"`（`markdownToHtml` 后处理）。
- 移动端 `background-attachment: fixed` 改为 `scroll`（≤820px），消除滚动重绘卡顿。

## Bug 修复
- **密度设置此前是死功能**：`--space-scale` 定义后从未被消费；现 `--sp-*` 系列统一乘以该系数，紧凑/标准/舒适真实生效。
- **音乐播放器折叠即断播**：折叠分支未渲染 `<audio>`；现常驻挂载，折叠只隐藏控制条，并用 onPlay/onPause 同步真实播放状态。
- **AI 助手按钮双语重影**：`.ai-assistant-launcher span` 选择器过宽，把 I18nText 两个语言 span 都渲染成圆形徽章；徽章改用专属 class。
- **hydration 告警**：`UserPreferencesScript` 预注水改写 `<html data-*>` 属性与 SSR 输出不一致；根布局加 `suppressHydrationWarning`。
- 后台侧边栏「仪表盘」在所有子页误高亮（prefix 匹配改 exact）。
- 文章"原始来源"外链补 `rel="noopener noreferrer"`。

## SEO / 元数据
- 根布局改 `generateMetadata`：站点名/描述取自数据库，标题模板 `%s · 站点名`，补 OG 基础字段。
- 列表与功能页（/posts /videos /stats /about /write /settings）补 title/description/canonical；/settings 加 noindex。
- 文章页输出 Article JSON-LD，视频页输出 VideoObject JSON-LD。
- `viewport`/`themeColor` 迁移到 Next 15 规范导出，theme-color 按明暗双值（替换原先与任何主题都不匹配的 #9f4f2f）。

## 可访问性 / UX
- 新增品牌化 404（根 `not-found.tsx`）与错误页（`(public)/error.tsx`，含重试）。
- 顶部导航用 ActiveLink 高亮当前页（`aria-current` + `.nav a.active` 样式）。
- AI 助手：Esc 关闭、打开自动聚焦、面板关闭时 `inert`（不可 Tab 进入）、输入上限 4000 对齐服务端。
- /stats 时间窗口改为 `aria-current` 链接导航（移除误用的 `role="tablist"`）。
- /videos、/stats、/about、分页、图表空态等此前中文硬编码处全部接入 I18nText 双语。
- 页脚新增 © 年份 + RSS + Sitemap 链接；搜索框改 `type="search"` + `enterKeyHint`；日期改 `<time dateTime>`。

---

# 本次迭代：博客扩展功能上线指南

## 新增功能（已完成）

### 1. 表示层
- **多主题**：minimal（默认）/ dark / sepia / ocean / forest / sunset / midnight。`globals.css` 全部走 CSS 变量；`<html data-theme=...>` 切换。
- **多字体**：6 种全部为免费字体（系统字体或 Source Han / Noto / LXGW WenKai）。`<html data-font=...>` 切换。
- **密度**：紧凑 / 标准 / 舒适。
- **用户设置页**：`/settings`，让访客自选主题/字体/密度/音乐，保存在 localStorage（浏览器本地，不影响他人，不需要账户）。
- **管理员默认主题/字体**：`/admin/settings` 中设置；用户首次访问时使用管理员的默认值。
- **响应式**：在 480 / 820 / 960 px 三个断点重写样式，移动端 admin 侧边栏变 sticky 顶部条。

### 2. 数据可视化
- **`/stats`**：访客可见。提供「当天 / 本周 / 全部」3 个时间窗口；6 张图：
  - 新闻每日柱状图
  - 视频每日折线图
  - 新闻 vs 视频堆叠柱
  - 分类占比环形图
  - 当天 24 小时小时分布
  - 分类详情列表
- **`/admin/stats`**：管理员看板，更全面的指标。
- 全部用 SVG + CSS，无第三方图表库。

### 3. 业务逻辑
- **AI 全局提示词前缀**：`SiteSettings.globalPromptPrefix`，自动加到每次 AI 请求的 system 之前。
- **自动发布开关**：原本就有；现在和定时调度联动。
- **信息源模块化**：新模型 `SourceModule`，源可关联多个模块；`/admin/modules` 管理；`Source` 列表可按模块筛选；Topic 抓取时只用关联模块的源。
- **Exa 检索**：管理员可在 `/admin/settings` 启用 Exa（提供 API Key 加密存储）；Worker 在关键词研究时会拉 Exa 结果（国内 / 国外 / 全量按 scope 限定 includeDomains）。
- **视频整合**：抓页面时同时收集 `<video>` / 链接；按 host 区分国内外：
  - 国外视频：只存链接（EMBED 或 LINK）
  - 国内视频（B 站、微博、爱奇艺、优酷、腾讯视频、抖音等）：尝试用 `yt-dlp` 下载，限时长 ≤ 20 分钟，一篇文章最多下载 1 个，失败回退为链接。每个视频都附带"来源页 + 原始链接 + 平台 + 版权说明"。
- **音乐**：`/admin/music` 上传 MP3/M4A/OGG/WAV（≤30 MB），用户在 `/settings` 启用并选曲，全站浮动播放器（折叠/换曲/音量/关闭）。

### 4. 数据访问层
- **存储管理**：`SiteSettings` 加 `maxStorageMb` / `cleanupAfterDays` / `cleanupCustomEnabled` / `textOnlyMode` / `videoMaxDurationSec` / `videoDownloadDomestic`。
- **纯文本模式**：开启后抓取不附加视频，节省空间。
- **清理策略**：超期 FetchJob 删除、孤儿 RawItem 删除、超额时把旧文章归档（不删内容），归档文章本地视频文件回收。可在管理后台一键执行 `/api/admin/storage/cleanup`。

### 5. 性能
- `PublicShell` 把 `SiteSettings` 走 `unstable_cache`（60s + 标签 `site-settings`），管理员保存时 `revalidateTag` 立即刷新。
- `/stats` `revalidate = 60` 缓存。
- `next.config.ts`：`/_next/static/*` 1 年 immutable，`/uploads/*` 1 小时缓存；启用 compress；`optimizePackageImports`。
- `globals.css` 重写后总体减少冗余。

---

## 部署步骤（在 /root/video 下执行）

> 前提：`docker compose` 已经在跑，postgres 容器名 `video-postgres-1`，redis 容器名 `video-redis-1`，docker 网络 `video_default`。

### 1) 应用数据库迁移

我已经写好了 idempotent SQL：`prisma/migrations/20260503010000_blog_extensions/migration.sql`

启动起来的 app 容器在 `start-app.sh` 里会执行 `npx prisma migrate deploy`。所以**最简单的就是重建并重启 app 容器**：

```bash
cd /root/video
docker compose build app worker
docker compose up -d app worker
```

如果你只想先单独应用迁移（不重启）：

```bash
docker exec -i video-postgres-1 psql -U shibei -d shibei_blog \
  < prisma/migrations/20260503010000_blog_extensions/migration.sql
```

并把它登记到 `_prisma_migrations` 让 prisma 不重复跑：

```bash
docker exec -i video-postgres-1 psql -U shibei -d shibei_blog -c \
"INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'manual', now(), '20260503010000_blog_extensions', now(), 1) ON CONFLICT DO NOTHING;"
```

### 2) （可选）安装 yt-dlp 让国内视频可下载

```bash
docker exec video-worker-1 sh -c "apk add --no-cache yt-dlp || apt-get update && apt-get install -y yt-dlp || true"
```

或者改 `Dockerfile`，加 `RUN apk add yt-dlp` / `RUN apt-get install -y yt-dlp`，然后重建。

没装 yt-dlp 时国内视频会自动回退为链接，不会报错。

### 3) 用提供的测试模型登录后台配置

1. 浏览器打开 `http://<host>/admin`，用 `.env` 里的 ADMIN_USERNAME/ADMIN_PASSWORD 登录
2. `/admin/settings`：
   - 模型配置区填：
     - 名称：`Kimi (canopywave)`
     - Base URL：`https://inference.canopywave.io/v1`
     - Model：`moonshotai/kimi-k2.6`
     - API Key：你给我的那串
   - 主题/字体默认值随便选个
   - 存储上限/清理天数按你 VPS 实际容量
3. `/admin/modules`：可以新建几个模块如「AI」「财经」「娱乐」
4. `/admin/sources`：添加几个 RSS（可勾选模块、地区）
5. `/admin/music`：（可选）上传一首背景音乐
6. 仪表盘点击「抓取默认信息源并总结」或「关键词写新闻」开始联调

### 4) 验证页面

```bash
for path in / /news /videos /stats /settings /about /admin /admin/settings /admin/modules /admin/music /admin/stats; do
  printf "%-22s %s\n" "$path" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000$path)"
done
```

期待非 admin 路径返回 200；admin 路径未登录返回 302/200（登录页）。

### 5) 一键回滚

新迁移用 `IF NOT EXISTS` 守卫，删除时把新增的列、表、enum 删掉即可。需要的话我可以补一份 down.sql。

---

## 备注

- 我建议这次联调完成后**轮换/撤销**你共享给我的 canopywave key（凭据不应长期共享）。
- 国内视频下载尽量遵守平台 ToS；本工程已经把"来源页 / 原视频链接 / 平台 / 时长 / 版权说明"附在 Video 模型与前台展示中，符合"标注获取处与源链接"的合规要求，但具体合法性还需结合视频内容判断。
- `_SourceToModule` 与 `_TopicToModule` 是 Prisma 的隐式关系表，命名是 `_<RelationName>`；如果你之前在数据库里做过手工改动可能会冲突。

---

## 三种部署形态(2026/05/03 新增)

把这个单体应用拆为三种部署形态，由 `APP_MODE` 环境变量控制。详细同步协议见 [SYNC.md](./SYNC.md)。

### 1) 完整版（默认，与历史行为一致）

```bash
cd /root/video
APP_MODE=full docker compose -f docker-compose.yml up -d
# 不设 APP_MODE 也行，默认 full
```

### 2) 后端形态（只跑抓取/总结/调度，对外暴露 ZIP）

```bash
cd /root/video
# .env 中至少:
#   APP_MODE=backend
#   SYNC_TOKEN=<openssl rand -hex 32 生成的随机串>
docker compose -f docker-compose.backend.yml up -d
```

后端起来后:
- `/admin` 仍然可以登录，所有管理功能在
- `/`、`/news` 等公开页会被中间件重定向到 `/admin`
- `GET /api/admin/sync/export?since=...` 可以拉 ZIP（带 `Authorization: Bearer $SYNC_TOKEN`）

### 3) 前端形态（轻量，只展示，自动从 backend 拉文章）

```bash
cd /root/video
# .env 中至少:
#   APP_MODE=frontend
#   SYNC_MODE=auto
#   SYNC_INTERVAL_MINUTES=15
#   BACKEND_API_URL=https://backend.example.com
#   SYNC_TOKEN=<和 backend 同一串>
docker compose -f docker-compose.frontend.yml up -d
```

`BACKEND_API_URL` 携带 Bearer `SYNC_TOKEN` 并代理 AI 请求；跨机严禁使用
`http://<公网 IP>:3000`。请使用 HTTPS 反代；受防火墙保护的 WireGuard/Tailscale/LAN 可连接私网 IP，
SSH 隧道可连接 frontend 上的本地端口（例如 `http://127.0.0.1:3300`）。完整示例见 [SYNC.md](./SYNC.md)。

前端起来后:
- `/admin/sync` 显示当前模式 / 上次同步 / 立即同步按钮 / 手动 ZIP 上传
- 容器内的 `sync-worker` 进程每 `SYNC_INTERVAL_MINUTES` 分钟拉一次增量
- AI 公开端点（站内助手 / 翻译 / 写作助手）透明转发到 backend
- 镜像不含 Playwright/yt-dlp/ffmpeg/python3，体积约 700-800MB（对比完整版 ~2GB）

### 视频在文章中的位置

视频可以在 `/admin/videos` 上传或在文章编辑页直接上传。挂到文章后，在正文 Markdown 任意位置写：

```
[[video:cm123abc]]
```

会被替换为对应视频的播放器。未被引用的视频会自动展示在文章末尾「相关视频」区。

### 数据库迁移

新增的迁移 `20260503110000_sync_state` 创建 `SyncState` 单行表。和其它迁移一样，
启动时 `start-app.sh` 会自动 `prisma migrate deploy` 应用，无需手动执行。

### 升级现有 full 部署到本次改动

```bash
cd /root/video
git pull
docker compose -f docker-compose.yml build app worker
docker compose -f docker-compose.yml up -d app worker
# 看一下日志，迁移应当自动跑过
docker logs video-app-1 --tail 50
```

`/admin/sync` 会出现在管理后台侧栏（即使 full 模式也可以用作 ZIP 备份/恢复工具）。


## 备份与恢复

每日备份由 `scripts/backup.sh` 完成：Postgres 全库 `pg_dump --format=custom` + `shibei_app-uploads` 卷打包，
默认存到 `/home/app/backups`，保留 14 天。**强烈建议配置异地同步**（`SHIBEI_BACKUP_SYNC_CMD`，如 rclone
到对象存储），否则备份和数据同盘，机器级故障救不回来。

安装每日 systemd timer（04:30，带随机延迟与错过补跑）：

```bash
sudo /home/app/ShiBei/scripts/install-backup-timer.sh
systemctl list-timers shibei-backup.timer
```

仓库不会假设 cron/timer 已经安装；只有上述安装命令成功后才存在每日任务。首次安装后建议执行
`sudo systemctl start shibei-backup.service`，再检查 `systemctl status shibei-backup.service`。

手动备份一次：

```bash
/home/app/ShiBei/scripts/backup.sh
```

恢复数据库（先停 app/worker 防止写入）：

```bash
docker compose stop app worker
docker compose exec -T postgres pg_restore -U shibei -d shibei_blog --clean --if-exists < /home/app/backups/db-YYYYMMDD-HHMMSS.dump
docker compose start app worker
```

恢复配图卷：

```bash
docker run --rm -v shibei_app-uploads:/uploads -v /home/app/backups:/backup:ro alpine \
  sh -c 'rm -rf /uploads/* && tar -xzf /backup/uploads-YYYYMMDD-HHMMSS.tar.gz -C /'
```
