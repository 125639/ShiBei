# Docker 容器补充验收（2026-10-04）

> 公开版验收记录：本机路径已脱敏。`${AUDIT_ROOT}` 代表操作者自己的验收目录；文中本地实例、日志和控制脚本不随 Git 仓库分发，也不是通用部署入口。

## 当前状态与入口

三个版本均已在本机隔离 Docker 环境运行；不是远程生产服务器或公网 HTTPS 部署。

| 实例 | 入口 | 当前应用镜像 |
| --- | --- | --- |
| 完整版 | http://127.0.0.1:3340/zh | `shibei-audit:full-query-fix` |
| 前端版 | http://127.0.0.1:3341/zh | `shibei-audit:frontend-query-fix` |
| 后端版 | http://127.0.0.1:3342/admin | `shibei-audit:backend-query-fix` |

完整版/后端版的独立 worker 使用对应的 `*-video-port-fix` 镜像。应用层与 worker 的补丁范围不同，详见下面的构建记录。

- 项目名：`shibei-audit`。
- 配置目录：`${AUDIT_ROOT}/docker-config`。
- 登录信息：登录凭据单独保存在验收机，不随仓库分发。
- PostgreSQL 16、Redis 7 使用本轮独立容器和数据卷；各模式使用独立数据库。
- 应用端口只绑定本机回环地址。原项目 `.env`、原数据库和上传文件未更改。
- 同一主机不同端口共享浏览器 Cookie 域，建议用独立浏览器配置文件体验三个后台；自动化使用独立浏览器上下文。

## 构建与磁盘记录

1. 安装并真实使用 Docker Engine、Compose、Buildx、ffmpeg、yt-dlp。
2. Docker Hub 直连失败，基础镜像通过镜像代理取得。Dockerfile 新增可选 npm、Debian、Prisma、PyPI 镜像参数，默认不改变上游地址；未关闭 TLS 或 Debian 包签名校验。
3. 完整版和前端版 Dockerfile 构建成功。
4. 后端全部构建步骤和镜像导出完成，但最后解包时触发 2 GiB 低磁盘保护，CLI 被中止。清理缓存后，已经导出的镜像完成运行时解包，实际启动 Node、Next.js、Prisma、Chromium 和 ffmpeg 均成功。**不把这次中止的 CLI 返回值记为构建命令成功。**
5. 联测发现查询参数页面 500 后，三种模式分别在无 `DATABASE_URL` 的隔离构建目录重新编译应用层，再以 Docker 小层更新现有运行镜像；不重新下载整套依赖。
6. B 站 CDN 端口修复只更新独立 worker 实际执行的三个 TypeScript 源文件。`downloadVideoToLocal` 的生产调用点仅在 worker，Web 应用不执行下载。
7. 全量构建有 6 GiB 启动余量要求和 2 GiB 运行中止底线；应用层小更新单独预算。每轮清理本次无用构建缓存，数据库卷、上传文件、源码及备份保留。
8. 已完成的完整版镜像曾压缩保存并恢复，旧本机运行包也已压缩。当前磁盘可用约 **3.8 GiB**，不建议立即再发起全量构建。

## 已实际验证

### 三个版本共用与模式隔离

- 各数据库完整执行 44 条迁移和 seed；重启后迁移幂等、登录和健康检查通过。
- 学习页面/API 返回 404，数据库没有学习节点、题目、教材和教材页表。
- full/frontend 中英文首页、文章、社区、关于、统计及带查询参数的列表/统计/旧 news 路由正常。
- frontend 的本地抓取、模型配置等 worker 管理入口被隔离；backend 公开页面按模式重定向。
- 前端没有 Redis 配置，也没有 ffmpeg、yt-dlp 或浏览器二进制；应用堆上限 192 MB。
- full/backend 容器内真实 Chromium 可启动并渲染；ffmpeg 可编码/解码，yt-dlp 可运行。

### 业务回归

**23 个模式/脚本组合最终全部通过，共 157 条 PASS 输出**，覆盖管理员 CRUD、媒体上传删除、ZIP 往返、会员认证、同源请求、所有权、匿名 bootstrap、纯手写交接、社区治理、私有列表分页、管理员改名/改密与会话吊销。

另补测 full/frontend 评论：匿名拒绝、HTML/XSS 纯文本呈现、禁止删除他人评论、作者删除、管理员删除，均通过。此部分明确不包含 AI 调用。

### 发布、同步与缓存

- 后端通过管理接口发布 → 前端手动拉取 → 公开文章可读。
- 重复同步不产生重复文章。
- 后端更新 → 前端 sync-worker 自动增量导入，心跳正常。
- 中英文已缓存文章在编辑或同步后立即显示新标题。
- 重启后同步文章仍在，更新后的标题可见。
- 390×844 手机文章页无横向溢出。

### 真实抓取与媒体

- full/backend 使用应用自身的 RSS 和安全浏览器抓取函数，实际访问 Solidot RSS 和其中一篇正文：均取得 5 条 RSS 记录及超过 2000 字符的 Markdown。没有绕过出站安全代理。
- 生成并转码真实 H.264/AAC 测试视频，上传后逐字节核对；Range 206、ETag 304 正常。
- 通过真实后台设置表单启用视频；开关可以隐藏并恢复已缓存文章的播放器。
- 后端含媒体 ZIP → 前端导入 → 浏览器实际播放并验证时长/分辨率。
- 删除后，数据库媒体记录和文件 URL 均不可访问。
- full/backend 分别通过真实管理接口入队，经 BullMQ → yt-dlp/ffmpeg 下载 B 站测试视频，转换为 LOCAL、HTTP 读取、ffprobe 校验并用 ffmpeg 解码首秒，最后删除验证。
- 下载样本约 212 秒、480p、9.9 MiB，包含 AV1 视频和 AAC 音频。没有用模拟模型或下载器替代。

## 本轮发现与修复

1. **无数据库构建失败**：语言布局原来在构建时枚举语种并预渲染首页，导致 Docker 构建读取缺失的 `DATABASE_URL`。改为首次请求生成，保留适合页面的 ISR。
2. **查询参数页面 500**：文章列表、统计、旧 news 路由需要动态参数，却在首次请求时进入静态生成。明确设为动态渲染，保留现有显式数据缓存。
3. **语言缓存失效遗漏**：补齐实际 `/zh/...` 和 `/en/...` 的刷新路径，编辑及同步后双语言均正确更新。
4. **B 站下载被本地策略拒绝**：实际媒体 URL 使用 HTTPS `*.mcdn.bilivideo.cn:8082`。只为该 CDN 添加 8082 例外，仍要求代理认证、受信主机、公网 IP 和 DNS 固定连接。其他域名/端口、HTTP 8082、私网地址仍拒绝，新增安全回归通过。
5. **测试脚本过期假设**：匿名 Cookie 名与语言路由检查改用实际约定；社区测试直接写入数据库，现使用独立题材缓存键，避免已有列表缓存污染测试。修正后复测和完整回归通过，不通过修改应用鉴权来迁就测试。
6. **生产依赖安全告警**：升级 Next.js 16.3.8 及相关安全修复依赖。当前 npm bulk advisory 接口检查 185 个生产包，返回 0 条告警。旧 npm CLI 的 quick audit 接口退役错误另行保留，未伪称该命令成功。

全量 `npm test` 通过；`npm run check` 通过（0 error，6 warning）。这不代表形式化证明不存在任何漏洞。

## 明确未完成/未宣称通过

- **真实 AI 生成、翻译、评分、访谈成稿等**：完整版和后端版启用模型配置数均为 0。已验证 full/frontend 返回明确的未配置错误，以及 backend 拒绝未鉴权直接 AI 调用；这不能替代真实模型成功验收。
- 真实外站下载用 B 站样本验证，不宣称所有 YouTube/Vimeo 等站点均可达；之前对它们的连接探测失败。
- 未配置公网域名、HTTPS、反向代理或远程生产服务器。
- 隔离容器保留运行，但未配置系统级开机自启策略。

因此，不能将本报告表述为“所有功能均已全部验证通过”。补齐可用模型配置后，才能继续真实 AI 链路。

## 证据与控制

根目录：`${AUDIT_ROOT}`。

- `docker-results/results-final.json`：23 组最终结果及日志名。
- `docker-results/comments-results.json`：评论补测。
- `docker-results/matrix-final.log`、`invalidation-final.log`、`restart-final.log`。
- `docker-results/real-media-final.log`、`media-results.json`、`*-download-probe.json`。
- `docker-results/*-live-scrape.log`、`dependency-bulk-audit.json`。
- `docker-results/source-tests-final.log`、`source-check-final.log`、`egress-port-tests.log`。
- `container-audit`、`public-query-fix`、`video-port-fix`：构建、保护中止、恢复和增量部署记录。

```sh
sudo docker compose -p shibei-audit -f "${AUDIT_ROOT}/docker-config/compose.yml" ps
sudo docker compose -p shibei-audit -f "${AUDIT_ROOT}/docker-config/compose.yml" up -d
# 停止本次验收容器并保留数据卷，不加 --volumes。
sudo docker compose -p shibei-audit -f "${AUDIT_ROOT}/docker-config/compose.yml" down
```
