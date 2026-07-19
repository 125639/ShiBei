// 用 .mjs 而不是 .ts:next start 运行期加载 TS 配置要靠 @next/swc 原生二进制
// 转译(~245MB),换成纯 JS 配置后运行镜像就能把 SWC 删掉。构建期两者皆可。

// 除页面自身的缓存策略外，统一给所有响应加保守的安全头。
// 不上全量 CSP：Next 的内联 runtime script 需要 nonce 改造，收益/风险比不划算；
// XSS 面已由 DOMPurify（正文渲染唯一注入点）收敛。
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // 只声明同源框架许可；配合 X-Frame-Options 兼容老内核
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" }
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Reduce CSS payload + better chunk hashing for repeat visits.
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
  // ISR/数据缓存只走磁盘，不再另设默认 ~50MB 的进程内 LRU：
  // 1核/1G 前端机上 Next 堆只有 192MB,这 50MB 比磁盘读快带来的收益贵得多。
  cacheMaxMemorySize: 0,
  // 站内封面与正文图都走 /_next/image。uploads 图片文件名是内容 sha256，
  // 内容变了 URL 必变，优化结果可以放心长缓存（31 天）。
  images: {
    minimumCacheTTL: 2678400,
    // 只转 WebP：AVIF 编码在 1 核低配前端机上极耗 CPU（单张可达数秒），
    // WebP 兼顾体积与速度；不支持 WebP 的老浏览器自动回退到原格式缩放版。
    formats: ["image/webp"],
    // 仅允许 q=75（站内所有 /_next/image 调用都用 75）——避免为不同 quality
    // 值反复生成多份缓存，省磁盘也省重复转码。
    qualities: [75]
  },
  // Metadata streaming 会在 DOMContentLoaded 后用 $RC/$RV 脚本搬动 body 中的
  // Suspense 标记；慢客户端水合与这次 DOM surgery 竞争时会偶发 React #418。
  // 本站 metadata 与根布局读取同一份缓存设置，本来就会等待它，因此统一改为
  // 阻塞式 metadata 不会新增实际数据依赖，却能保证交给 React 的 DOM 不再变形。
  htmlLimitedBots: /.*/,
  experimental: {
    optimizePackageImports: ["marked", "isomorphic-dompurify"],
    // 客户端路由缓存：30s 内往返导航（返回列表/再进文章）不重新请求，
    // 配合页面过渡动画消除「每次点击都白等」的顿挫感。
    staleTimes: {
      dynamic: 30,
      static: 300
    }
  },
  // Cache static assets aggressively (revalidate on filename hash).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS
      },
      {
        source: "/uploads/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // 用户/抓取来源的文件一律当附件域处理：即便混入可执行内容也不在站点源下解释
          { key: "Content-Security-Policy", value: "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox" }
        ]
      }
    ];
  }
};

export default nextConfig;
