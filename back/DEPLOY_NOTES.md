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
#   BACKEND_API_URL=http://<backend-host>:3000
#   SYNC_TOKEN=<和 backend 同一串>
docker compose -f docker-compose.frontend.yml up -d
```

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

