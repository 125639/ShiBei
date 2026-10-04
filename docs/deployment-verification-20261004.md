# 三种部署模式端到端验收（2026-10-04）

> 公开版验收记录：本机路径已脱敏。`${AUDIT_ROOT}` 代表操作者自己的验收目录；文中本地实例、日志和控制脚本不随 Git 仓库分发，也不是通用部署入口。

> 后续状态：本报告是之前的本机运行包验收记录。旧运行包现已压缩归档，当前使用 Docker 隔离部署；请以 `container-verification-20261004.md` 的入口、状态和控制命令为准。


## 部署范围

本机没有 Docker/Podman。本次使用生产构建和 `package-runtime.mjs` 运行包，分别部署 `full`、`frontend`、`backend`，**不是 Docker 镜像或远程生产服务器部署**。

- 完整版：http://127.0.0.1:3310
- 前端版：http://127.0.0.1:3311
- 后端版：http://127.0.0.1:3312/admin
- 部署目录：`${AUDIT_ROOT}`
- 登录信息：登录凭据由验收环境单独管理，不随仓库分发。
- 三个独立数据库：临时 PostgreSQL 18 实例，端口 55440。
- 独立 Redis：端口 56380，仅 full/backend 使用不同逻辑库。
- frontend 最终配置无 `REDIS_URL`，Node 堆上限 192 MB；sync-worker 堆上限 128 MB。full/backend 堆上限 512 MB。
- 所有服务仅监听本机；原项目 `.env` 和现有数据库未修改。
- 同一主机不同端口会共享浏览器 Cookie 域，建议分别使用浏览器配置文件体验三个后台；自动化测试使用独立上下文。

## 已完成验证

1. 三种 APP_MODE 分别完成 Next.js 生产构建、生产依赖裁剪和运行包打包。
2. 各自从空数据库完整执行 44 条迁移及 seed；通过正式 `scripts/start-app.sh` 启动。
3. 健康检查、管理员登录、后台文章/视频/设置/同步页面、退出及权限撤销。
4. full/frontend 的中英文首页、文章列表、社区、关于、统计页；backend 的公开页面重定向；frontend 的本地 worker 页面/API 隔离。
5. 三种模式学习页面及 API 均为 404；数据库无学习节点、题目、教材或教材页表。
6. 管理员模块、来源、主题、风格、文章、模型连接、邀请码的真实 CRUD。
7. 正文图片、音频、视频的文件签名校验、上传、公开读取和删除（不是视频解码/转码测试）。
8. 会员邀请码开户、凭据升级、登录退出、会话吊销；所有权和匿名身份隔离；JSON/同源请求边界。
9. ZIP 导出/删除/导入恢复与重复导入幂等。
10. 后端通过真实管理接口发布 → 前端手动同步 → 前端公开阅读；后台更新 → sync-worker 自动增量同步；心跳与重启后持久化。
11. full/backend 的真实 BullMQ worker 消费安全的调度空任务，不访问外网或调用付费模型。
12. 生产 ISR：预热中英文文章页后修改文章，两个语言版本首次重新请求均显示新标题；同步更新也正确失效中英文页面。
13. 手机 390×844 阅读页无横向溢出；浏览器主流程无 pageerror。
14. 服务重启后健康、登录、迁移幂等、文章持久化正常；前端无 Redis、192 MB 堆上限配置下跨版本主流程通过。
15. full/frontend 未配置模型时返回明确的 503；frontend 代理到 backend 链路可达；backend 拒绝未持共享密钥的直接 AI 调用。

12 组现有真实端到端脚本最终全部通过，共 84 条 PASS 输出；另有跨模式、缓存和重启专项检查。全量 `npm test` 通过；`npm run check` 通过（5 条既有 warning，0 error）。

## 本轮发现并修复

- 公开缓存失效遗漏语言前缀：原先只失效 `/posts/...`，实际 `/zh/posts/...`、`/en/posts/...` 仍可能显示旧内容。新增统一语言路径展开，并加入自动化回归测试，重新构建部署三种模式后验证通过。
- 匿名 bootstrap 验收脚本漏识别生产 HTTP Cookie 名：改用统一 Cookie 名常量及提取工具；复测通过。此项为测试脚本修复，不是绕过应用鉴权。

## 限制与观察

- 未构建/运行 Docker 镜像，未验证 HTTPS、域名、反向代理或远程生产服务器。
- 本机没有 ffmpeg/yt-dlp，真实视频下载、解码、转码未验证。
- 隔离数据库未配置真实模型密钥；付费 AI 内容生成、外网采集及真实定时内容生产未验证。调度空任务通过不代表这些外部服务通过。
- 运行包首次 `npm ci` 的 Prisma 引擎下载长时间未完成，已停止；最终在独立构建副本中复用本机依赖、离线裁剪开发依赖后打包，未改变原项目 node_modules。
- 同时重启时前端可能先于后端就绪，出现一次连接拒绝；本轮同步进程按退避机制自动恢复，随后同步成功。
- 首轮负向请求测试期间 full 日志有一次 ECONNRESET/aborted；服务未退出，后续健康、重启及主流程均通过。未将该日志归因于学习功能移除。

## 日志与控制

部署目录下：

- `e2e-results.json`：12 组脚本最终结果及日志名。
- `matrix-lightweight-final.log`：最终轻量配置跨版本流程。
- `invalidation-final.log`：管理员编辑后的双语言缓存验证。
- `restart-final.log`：重启、持久化、AI 未配置边界验证。
- `full-rebuild.log`、`frontend-rebuild.log`、`backend-rebuild.log`：最终生产构建。
- `*-app.log`、`*-worker.log`：运行日志。
- `frontend-mobile-article.png`：手机文章截图。

```sh
# 只控制本次隔离部署的应用/worker，不影响原项目服务。
node "${AUDIT_ROOT}/control.mjs" status
node "${AUDIT_ROOT}/control.mjs" restart
node "${AUDIT_ROOT}/control.mjs" stop
```

服务当前保留运行，未配置系统开机自启；上述 stop 不关闭隔离 PostgreSQL/Redis。旧运行包以 `*-v1` 保留用于对照，当前目录为包含缓存修复的新运行包。
