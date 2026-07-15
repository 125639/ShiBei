# 数据同步协议（SYNC.md）

ShiBei 在拆分为「前端 / 后端 / 完整版」三种形态后，后端产出的文章和视频通过本文档描述的协议传输到前端。三种形态的应用层都默认提供 HTTP `:3000`；域名和 TLS 由部署者的外部反向代理管理。

## 三种形态

| 形态 | APP_MODE | 含 BullMQ Worker | 含 Playwright/yt-dlp | 公开页 | Admin 全功能 | 同步角色 |
| --- | --- | --- | --- | --- | --- | --- |
| 完整版 | `full` | ✅ | ✅ | ✅ | ✅ | 既能导出也能导入（自给自足） |
| 后端 | `backend` | ✅ | ✅ | ❌（重定向到 /admin） | ✅ | 仅导出 |
| 前端 | `frontend` | ❌ | ❌ | ✅ | 仅展示控制（视频/音乐/同步/设置/文章） | 仅导入 |

## HTTP 应用层与公开入口

每台服务器都先启动对应 Compose，并用本机 HTTP 健康检查验证：

```bash
curl http://127.0.0.1:3000/api/health
```

公网部署时，前端和后端各自使用外部 Nginx/Caddy/Traefik 将 HTTPS 域名转发到 `http://127.0.0.1:3000`。应用不申请证书，更新器也不接管代理、DNS 或证书。可复用 [ops/reverse-proxy](./ops/reverse-proxy/README.md) 中的标准样例。

## 关键环境变量

```text
APP_MODE              full | backend | frontend
SYNC_MODE             auto | manual    (frontend 用,默认 auto)
SYNC_INTERVAL_MINUTES 15                (frontend + auto 模式下 sync-worker 拉取间隔)
PUBLIC_URL            该实例的浏览器公开起源（运行时配置）
APP_BIND_IP           0.0.0.0（直连 HTTP）| 127.0.0.1（同机外置反代）
APP_PORT              HTTP 应用端口，默认 3000
TRUST_PROXY_HOPS      可信反代固定层数，直连时为 0，同机单层时为 1
BACKEND_API_URL       https://backend.example.com   (frontend 必填；公网跨机禁止明文 HTTP)
SYNC_TOKEN            <长随机字符串>          (frontend / backend 双方相同)
SYNC_MAX_ZIP_MB       同步包大小上限。默认: frontend 128,其他形态 512。
                      ZIP 全量缓冲进内存,上限必须小于容器内存。
SYNC_MAX_FILE_MB      ZIP 内单文件上限。默认: frontend 96,其他形态 350。
                      超限文件跳过不中断(计入 filesSkipped)。
```

## 同步流程

### 自动模式（默认）

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

### 立即同步（自动模式 + 想立即触发一次）

前端 `/admin/sync` → 「立即同步」按钮 → POST `/api/admin/sync/pull`（管理员 session）
→ 同步调 `runAutoSync()` 等结果。

## ZIP 包结构

```
manifest.json    # SyncManifest:schemaVersion / exportedAt / since / counts / exporterMode
posts.json       # SyncPostPayload[]:Post 全字段 + tags + topics
videos.json      # SyncVideoPayload[]:Video 全字段
uploads/
  video/
    <hex>.mp4    # LOCAL 类型视频文件，按 video.localPath 同名打包
```

`schemaVersion` 不一致时拒绝导入，提示升级。

## 鉴权

`/api/admin/sync/export` 接受两种鉴权，任一即可：

- `Authorization: Bearer ${SYNC_TOKEN}`（机机调用，sync-worker 用）
- 管理员 session cookie（管理员手点导出）

`/api/admin/sync/import` 与 `/api/admin/sync/pull` 仅接受管理员 session（防止外部往前端塞内容）。

## 冲突策略

upsert 时按 `updatedAt` 比较：

- incoming.updatedAt > existing.updatedAt → 覆盖
- incoming.updatedAt ≤ existing.updatedAt → 跳过

这意味着：**前端 admin 改了已同步过的文章，下次 backend 同名 slug 的同步会被覆盖**。如果你需要保留前端的本地修改，要么：

1. 改完后修改文章 `slug` 让它脱离同步（后端没有同样 slug 就不会冲突）；
2. 在前端模式下编辑后，手动把 incoming 的 `updatedAt` 调到比本地更早（临时方案）。

未来可以加 `localOnly: bool` 字段，按需要再做。

## AI 公开端点的代理

frontend 模式下，以下端点会把请求（含 body 流）透明转发到 `${BACKEND_API_URL}` 同路径，带 SYNC_TOKEN：

- `POST /api/public/assistant`
- `POST /api/public/posts/[id]/translate`（本地有缓存翻译则直接用，不再代理）
- `POST /api/public/writing/assist`

前端因此不需要持有任何模型 API Key。所有模型配置在 backend 的 `/admin/settings`。

## 视频管理

视频（无论本地上传还是嵌入链接）都可以在前端 `/admin/videos` 添加，与同步的文章是独立的实体。挂到一篇文章后，正文 Markdown 里写 `[[video:VIDEO_ID]]`，该位置就会被替换为播放器。

未挂载到任何文章的视频会出现在 `/videos` 页面但不会自动出现在某篇文章里。

## 安全说明

- `SYNC_TOKEN` 是双方共享密钥。建议：

  - 用 `openssl rand -hex 32` 生成
  - 在 backend 与 frontend 的 `.env` 各填一份（同一个值）
  - 不要提交到 git
- `BACKEND_API_URL` 同时承载 Bearer `SYNC_TOKEN` 和由后端模型密钥执行的 AI 请求。**跨机不得使用 `http://<公网 IP>:3000`**；中间人可直接复制 token 并消耗模型额度。
- 应用会拒绝公网主机的明文 HTTP；HTTP 仅允许 localhost、私网 IP（含 Tailscale CGNAT/IPv6 ULA）或 Docker/LAN 单标签服务名，且入口必须是不带路径的 origin。
- 公网推荐 `BACKEND_API_URL=https://backend.example.com`，在 backend 前放外置 Caddy/Nginx/Traefik，证书由该反代或云入口续期。后端设 `APP_BIND_IP=127.0.0.1` 与 `TRUST_PROXY_HOPS=1`（单层时），防火墙可再只允许 frontend 出口 IP。
- 不想公开 backend 时，可在 frontend 上建立 SSH 隧道：

  ```bash
  ssh -NT -L 127.0.0.1:3300:127.0.0.1:3000 backend-user@backend.example.com
  # frontend .env
  BACKEND_API_URL=http://127.0.0.1:3300
  ```

  生产中应用 systemd 保活该隧道，或使用 WireGuard/Tailscale 并配置防火墙只允许两台机器互通。
- backend 应用应放在 HTTPS 反代或上述私网隧道后，只暴露给 frontend。受防火墙保护的 WireGuard/Tailscale/专用 VLAN 可以使用私网 HTTP。
- 前端从 backend 拉到的 ZIP 内容是受信任的（由后端管理员发布），import 流程不做额外内容审计。

## 更新边界

网页更新器按 `APP_MODE` 只更新 frontend 应用，或 backend/full 的应用与 worker。它不更新用户管理的 Nginx/Caddy/Traefik，不修改 `BACKEND_API_URL`、DNS 或 TLS 证书；更新后两端仍使用原有的 HTTP 端口与公开域名。
