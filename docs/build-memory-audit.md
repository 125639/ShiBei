# 1 核 / 0.8G 构建实测（2026-09-09）

**结论：当前版本在下面两套 1 核、800MiB、无 swap 的配置中，都没有完成完整生产构建。不能因为运行压缩包只有约 72MiB，就承诺 0.8G 的服务器可以编译。**

小内存目标机应部署已经编译好的运行包或镜像。`npm ci`、`npm run build` 和运行包打包放在构建机 / CI；目标机不要执行 `next build` 或使用 `docker compose up --build` 重建。0.8G 能否承载整个运行栈还需单独压测，本报告不为 full 模式的数据库、队列、Chromium 和 Worker 并发运行背书。

## 实验条件

- 宿主机实际为 4 个逻辑 CPU、3921MiB RAM；不是直接在一台物理 800MiB VPS 上测试。
- 使用独立 systemd cgroup 限制**整个构建进程树**，而非只限制某个 Node 进程的 V8 堆：
  - `CPUQuota=100%`，`AllowedCPUs=3`：只允许使用一个逻辑核。
  - `MemoryMax=800M`：800MiB（838860800 字节）；`MemorySwapMax=0`：不能借用宿主机 swap。
  - `OOMPolicy=kill`、20 分钟时限，防止实验进程拖垮正式站点。
- Node.js 20.19.2，Next.js 16.2.10，运行项目的完整 `npm run build`，包含 Prisma generate、Webpack、TypeScript、页面生成和构建跟踪；没有跳过类型检查。
- 两次都使用全新源码副本和独立依赖副本，没有 `.next` 或 TypeScript 增量缓存。依赖已提前安装，耗时不包含安装依赖。
- CPU 亲和性不会改变 `os.cpus().length`；通过 Next 已支持的 `CIRCLE_NODE_TOTAL=1` 将构建 worker 数对齐到真实单核机器的默认值。记录中 `availableParallelism=1`、`cpu.max=100000 100000`、`cpuset.cpus.effective=3`。
- 使用隔离测试数据库，位于构建额度之外。也就是说，800MiB 几乎全给了编译；真实小 VPS 还要额外给系统、Web 和数据库留内存。
- 正式服务全程未重启，两次实验共 16 次健康探测均通过。

## 结果

| 配置 | 完整构建结果 | 约耗时 | 构建进程组峰值 |
| --- | --- | ---: | ---: |
| 原配置，Node 自动堆上限 | **失败**：Webpack 阶段 V8 heap out of memory，SIGABRT | 47 秒 | 673.86MiB |
| 低内存配置 | **失败**：Webpack 用 69 秒通过，但 TypeScript 阶段 V8 heap out of memory，SIGABRT | 112 秒 | 794.65MiB |

两次 `npm run build` 退出码都是 1。第一轮并不是 cgroup OOM killer 杀死进程，而是 Node 根据受限内存设定的默认堆先达到上限；不能据此说“内存还有余量，所以构建成功”。第二轮同样没有完成类型检查，也不能把日志中的 `Compiled successfully` 当作完整构建成功。

第二轮仅在临时副本中设置：

```text
NODE_OPTIONS=--max-old-space-size=512 --max-semi-space-size=4
UV_THREADPOOL_SIZE=1
MALLOC_ARENA_MAX=2
```

```js
webpack(config, { dev }) {
  if (!dev) config.cache = false;
  return config;
},
experimental: {
  // 保留原配置的其他选项
  cpus: 1,
  webpackBuildWorker: true,
  webpackMemoryOptimizations: true,
  parallelServerCompiles: false,
  parallelServerBuildTraces: false
}
```

这些实验选项**没有写入正式构建配置，也不是推荐的可用部署方案**。本次没有测试增加 swap、拆分编译阶段、其他 Node 版本或所有可能的参数，结论限于上述实测，不声称数学上绝对无法通过任何特殊方案构建。

## 数据留存与下一步

本次日志、每约 300ms 的 cgroup 采样、配置副本和汇总保存在：

```text
${BUILD_AUDIT_ROOT}/results/
  baseline.log
  baseline.json
  baseline.next.config.mjs
  tuned.log
  tuned.json
  tuned.next.config.mjs
  summary.json
```

临时依赖与失败构建可以删除，不需要保留数 GB 测试副本；保留以上证据即可。正式 `.env`、依赖、构建、文章和队列未被实验替换。

已有的 `dist/shibei-runtime-linux-x64-20260908.tar.gz` 是**在较大构建环境中提前编译**的 Debian/glibc x64 运行包，不含数据库、上传、浏览器本体或操作系统；详见 [运行包说明](runtime-size.md)。部署该包无需在 0.8G 目标机重新安装开发依赖或编译 Next.js。使用远程镜像时，应确认镜像包含自己的定制代码，不能把上游公共镜像视为本地改动的等价物。
