import type { NextConfig } from "next";

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

const nextConfig: NextConfig = {
  // Reduce CSS payload + better chunk hashing for repeat visits.
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
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
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]
      }
    ];
  }
};

export default nextConfig;
