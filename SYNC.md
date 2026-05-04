# 数据同步协议(SYNC.md)

ShiBei 在拆分为「前端 / 后端 / 完整版」三种形态后,后端产出的文章和视频通过本文档描述的协议传输到前端。

## 三种形态

| 形态 | APP_MODE | 含 BullMQ Worker | 含 Playwright/yt-dlp | 公开页 | Admin 全功能 | 同步角色 |
|---|---|---|---|---|---|---|
| 完整版 | `full` | ✅ | ✅ | ✅ | ✅ | 既能导出也能导入(自给自足) |
| 后端 | `backend` | ✅ | ✅ | ❌(重定向到 /admin) | ✅ | 仅导出 |
| 前端 | `frontend` | ❌ | ❌ | ✅ | 仅展示控制(视频/音乐/同步/设置/文章) | 仅导入 |

## 关键环境变量

```
APP_MODE              full | backend | frontend
SYNC_MODE             auto | manual    (frontend 用,默认 auto)
SYNC_INTERVAL_MINUTES 15                (frontend + auto 模式下 sync-worker 拉取间隔)
BACKEND_API_URL       http://backend:3000   (frontend 必填)
SYNC_TOKEN            <长随机字符串>          (frontend / backend 双方相同)
```

## 同步流程

### 自动模式(默认)

```
前端容器内 sync-worker 进程
  ↓ 每 SYNC_INTERVAL_MINUTES 分钟
  GET ${BACKEND_API_URL}/api/admin/sync/export?since=<lastImportedAt>
  Authorization: Bearer ${SYNC_TOKEN}
  ↓ 200 application/zip
  → importFromZip() → DB upsert + uploads/video/* 写盘
  → SyncState.lastImportedAt = now
```

### 手动模式

1. 后端管理员打开 `/admin/sync` → 点击「下载全量 ZIP」或「下载增量 ZIP」
2. 把 ZIP 文件传给前端管理员
3. 前端管理员打开 `/admin/sync` → 「上传 ZIP 导入」中选择文件 → 点击「上传并导入」

### 立即同步(自动模式 + 想立即触发一次)

前端 `/admin/sync` → 「立即同步」按钮 → POST `/api/admin/sync/pull`(管理员 session)
→ 同步调 `runAutoSync()` 等结果。

## ZIP 包结构

```
manifest.json    # SyncManifest:schemaVersion / exportedAt / since / counts / exporterMode
posts.json       # SyncPostPayload[]:Post 全字段 + tags + topics
videos.json      # SyncVideoPayload[]:Video 全字段
uploads/
  video/
    <hex>.mp4    # LOCAL 类型视频文件,按 video.localPath 同名打包
```

`schemaVersion` 不一致时拒绝导入,提示升级。

## 鉴权

`/api/admin/sync/export` 接受两种鉴权,任一即可:
- `Authorization: Bearer ${SYNC_TOKEN}`(机机调用,sync-worker 用)
- 管理员 session cookie(管理员手点导出)

`/api/admin/sync/import` 与 `/api/admin/sync/pull` 仅接受管理员 session(防止外部往前端塞内容)。

## 冲突策略

upsert 时按 `updatedAt` 比较:

- incoming.updatedAt > existing.updatedAt → 覆盖
- incoming.updatedAt ≤ existing.updatedAt → 跳过

这意味着:**前端 admin 改了已同步过的文章,下次 backend 同名 slug 的同步会被覆盖**。如果你需要保留前端的本地修改,要么:

1. 改完后修改文章 `slug` 让它脱离同步(后端没有同样 slug 就不会冲突);
2. 在前端模式下编辑后,手动把 incoming 的 `updatedAt` 调到比本地更早(临时方案)。

未来可以加 `localOnly: bool` 字段,按需要再做。

## AI 公开端点的代理

frontend 模式下,以下端点会把请求(含 body 流)透明转发到 `${BACKEND_API_URL}` 同路径,带 SYNC_TOKEN:

- `POST /api/public/assistant`
- `POST /api/public/posts/[id]/translate`(本地有缓存翻译则直接用,不再代理)
- `POST /api/public/writing/assist`

前端因此不需要持有任何模型 API Key。所有模型配置在 backend 的 `/admin/settings`。

## 视频管理

视频(无论本地上传还是嵌入链接)都可以在前端 `/admin/videos` 添加,与同步的文章是独立的实体。挂到一篇文章后,正文 Markdown 里写 `[[video:VIDEO_ID]]`,该位置就会被替换为播放器。

未挂载到任何文章的视频会出现在 `/videos` 页面但不会自动出现在某篇文章里。

## 安全说明

- `SYNC_TOKEN` 是双方共享密钥。建议:
  - 用 `openssl rand -hex 32` 生成
  - 在 backend 与 frontend 的 `.env` 各填一份(同一个值)
  - 不要提交到 git
- backend 应用建议放在内网或反代后,只暴露给 frontend。
- 前端从 backend 拉到的 ZIP 内容是受信任的(由后端管理员发布),import 流程不做额外内容审计。
