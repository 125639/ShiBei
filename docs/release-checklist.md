# GitHub 发布与升级检查

## 本次变更

- 保留完整版、前端版、后端版三种模式，整理公开界面及后台工作区。
- 移除学习/教材功能及相关运行依赖，保留升级所需迁移兼容链。
- 修复中英文页面缓存刷新、无数据库构建、查询参数页面动态渲染和 B 站 MCDN 下载端口兼容。
- 更新生产依赖安全补丁，补充模式隔离、迁移、权限、缓存和媒体回归。

## 推送前

```sh
npm ci
npm run prisma:generate
npx playwright install --with-deps --only-shell chromium
npm run check
npm test
git diff --check
git status --short
```

禁止提交 `.env` 及备份、API 密钥、数据库、上传文件、私人教材、截图证据中的凭据、容器运行目录和本机计划记录。`.gitignore` 不会隐藏已经跟踪的文件，推送前仍须检查 Git 索引。

依赖锁文件使用官方 npm tarball 地址和完整性校验。网络受限时可使用安装器镜像参数，不应把私有 registry 凭据写入锁文件。

## GitHub CI

工作流支持 `main`、`master`、Pull Request 和手动触发：

1. 安装 Chromium，执行 lint、类型检查和测试。
2. 用临时 PostgreSQL 执行真实迁移回归、完整迁移链和 seed。
3. 分别构建 `full` / `frontend` / `backend`，构建任务不提供 `DATABASE_URL`。

CI 假密钥仅用于测试，不可用于部署。修改工作流的本地语法检查不等同于 GitHub Actions 已运行成功；首次推送后应确认实际结果。

## 三种 Docker 镜像

```sh
docker build -f Dockerfile -t shibei:full .
docker build -f Dockerfile.frontend -t shibei:frontend .
docker build -f Dockerfile.backend -t shibei:backend .
```

构建内存和临时磁盘占用远大于运行包。请逐个构建，并预留足够空间，不要在低配生产机上并行构建三个镜像。可选构建参数：

- `NPM_CONFIG_REGISTRY`：npm registry。
- `PRISMA_ENGINES_MIRROR`：Prisma 引擎镜像。
- `APT_MIRROR` / `APT_SECURITY_MIRROR`：Debian 主仓库/安全更新镜像。
- `PIP_INDEX_URL`：Python 包索引（完整版/后端版）。
- `PLAYWRIGHT_DOWNLOAD_HOST`：浏览器下载镜像（完整版/后端版）。

参数不传时保留工具默认值。不要关闭 TLS 验证或包签名校验来解决下载问题。

## 现有实例升级

1. 备份数据库、环境变量、上传目录和私人教材文件，并确认回滚镜像可用。
2. 学习移除迁移会删除教材/学习题目数据；它不负责删除磁盘上的旧教材，也不会自动删除原 Post 文章。
3. 不要删除、改写或手工重复执行已经登记的迁移。详情见 [迁移兼容说明](learning-removal-migrations.md)。
4. 部署后检查健康、登录、文章列表、统计、发布/同步、双语言缓存和媒体。
5. 真实 AI 链路必须配置可用模型后单独验收。

## 验证范围

本次本机 Docker 验收及限制见 [容器验收报告](container-verification-20261004.md)。报告中的测试目录、凭据和日志不属于仓库内容。

**真实 AI 生成、翻译、评分仍未完成成功验收，不能在发布说明中写成“所有功能全部通过”。** 公网域名、HTTPS、反向代理与目标生产服务器也应在实际环境复核。
