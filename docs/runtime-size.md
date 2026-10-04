# 运行包体积与可重复打包

不要把完整开发目录当作运行包。Webpack 缓存、编译器、编辑器源码依赖和依赖库的调试映射不需要随每次部署传输；数据库、上传目录和回滚备份则应独立保存。

> **构建内存与包体积是两回事。** 2026-09-09 实测：当前版本在 1 核 / 800MiB / 无 swap 下，默认构建和低内存配置均未完成完整构建。以下安装、编译和打包命令应在构建机 / CI 执行，不应在 0.8G 目标机执行。实验条件和原始结果见 [构建内存实测](build-memory-audit.md)。

## 生成自包含的 Node 运行目录

```bash
npm ci
npm run build
npm run package:runtime -- --out dist/runtime
# 可选：打成传输归档（不要在构建前把真实 uploads/.env 放进 dist/runtime）
tar -C dist/runtime -czf dist/shibei-runtime.tar.gz .
```

输出包含 Next.js 服务端和静态资源、生产依赖、Prisma 客户端/迁移工具、worker / sync-worker / seed 与维护脚本。它继续使用 `scripts/trusted-next-server.mjs`，不会绕过可信代理 IP 校验。

打包不会修改源码目录、现有 `node_modules`、线上 `.next` 或用户数据。已存在的输出目录会报错，而不是自动覆盖。生产目录不会包含 `.env`、`public/uploads`、数据库、备份或测试浏览器缓存。

```bash
cd dist/runtime
# 从部署系统注入正式环境变量或提供独立 .env，并挂载/链接 public/uploads。
# 如果构建时设置了 SHIBEI_DIST_DIR，运行该包时应取消：包内统一命名为 .next。
unset SHIBEI_DIST_DIR
NODE_ENV=production node scripts/trusted-next-server.mjs
# 其他入口仍兼容：
node node_modules/.bin/tsx src/worker/index.ts
node node_modules/.bin/tsx src/sync-worker/index.ts
node node_modules/.bin/prisma migrate deploy
```

`npm run build` 需要开发依赖，不能在精简运行目录中直接执行。编辑源码、重新安装/构建仍在原项目或 CI builder 中进行。

## 精简策略

1. 输出不带 `.next/cache`、开发类型工件、分析报告和 trace。缓存不跨环境复制，避免把另一个数据库的列表结果带入新部署；新实例会自行建立运行缓存。线上已有缓存只会在切换版本时随旧构建保留作回滚，不在原位置删除。
2. 按锁文件安装 `--omit=dev` 生产依赖。Tiptap、拖拽编辑器依赖只参与浏览器/SSR 构建，成品里已经编译进 `.next`，因此列为 `devDependencies`；这不删除编辑功能。
3. 移除仅供构建使用的 `@next/swc-*`、未使用的中文网络字体依赖、另一 OS/CPU/libc 的预编译包，以及不匹配当前系统的 Prisma 引擎。保留 tsx/esbuild、原生图片处理、Prisma 迁移、worker 和抓取所需依赖。
4. 默认不带生产依赖的 `.map` 调试文件和 Next 附带的开发文档。需要 Node 依赖源码映射时使用 `--keep-source-maps`；通常多出约几十 MiB，不影响业务功能。
5. `runtime-manifest.json` 记录构建 id、原生目标、实际字节数和裁掉的项目。不记录密钥或环境变量值。

**包是平台相关的**：在与部署系统相同的 CPU、libc、OpenSSL 环境中构建/打包。不能把 Debian x64 包直接复制到 Alpine 或 ARM。PostgreSQL、Redis、OS 系统库不包含在 Node 包内；full/backend 的 Playwright 浏览器也需独立安装。

### Docker

三个应用 Dockerfile 使用同一打包器。`--reuse-installed` 仅用于已经 `npm prune --omit=dev` 的可丢弃 builder；它拒绝复用符号链接依赖目录和仍安装开发依赖的目录，避免误裁共享开发环境。

完整版/后端 runner 改为 `node:22-bookworm-slim`，保留 OpenSSL、字体、Python、ffmpeg 等真实运行依赖；仅安装 `playwright install --with-deps --only-shell chromium`。现有抓取均使用 `headless: true`，无需同时携带完整 GUI Chromium。前端镜像仍不安装浏览器与视频下载系统工具。

`.dockerignore` 排除 `.next-*` 预览构建和 `dist`，避免将数百 MiB 的本地测试产物再次送进 Docker 构建上下文。

## 查看实际大小

```bash
npm run size
npm run size -- --build-dir .next --url https://你的域名/zh
```

报告使用文件实际字节数（MiB），`du` 可能显示更大的文件系统占用；不要混用这两种数字。页面报告为 HTML 引用的 JS/CSS 原始大小及 gzip 估算，包含 nomodule 兼容包，不包括动态加载、图片、协议开销，也不是所有浏览器的真实首屏传输量。

对比应区分三类：完整开发目录、独立 Node 运行包、包含 OS/浏览器的 Docker 镜像。不能把其中一种的数字说成另一种。Docker 配方的体积还需要有 Docker 构建环境才能实测。

## 浏览器资源

- 光标粒子引擎仅在用户启用且设备为精确指针、未要求减少动效时加载。
- AI 修订结果、写作完成预览和已交接的只读快照按需加载同一个净化后的 Markdown 渲染器。
- 渲染器加载失败时显示可恢复提示，不将未净化 HTML 作为回退，也不修改草稿。

检查命令：`npm run check`、`npm test`、`npm run test:ui`、`npm run test:admin-ui`、`npm run test:mobile`、`npm run test:lazy-ui`。后者使用模拟文档验证写作预览和光标开关，不保存真实文章。后台进程、迁移和手写交接的完整运行验证应使用独立 PostgreSQL/Redis，不能让测试 worker 消费正式队列。
