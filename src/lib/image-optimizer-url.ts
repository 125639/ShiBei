/**
 * 站内图片走 Next 图片优化端点（sharp 缩放 + 按 Accept 协商 WebP）。
 *
 * 实测 /posts 一页原图直出 6.4MB（单张最大 1.5MB）；经 /_next/image
 * w=828 后单张降到 ~100KB 且结果落盘缓存（首压 ~180ms，命中 ~10ms）。
 * 仅处理站内 /uploads 静态图：外链域名未在 remotePatterns 白名单会 400，
 * SVG 优化器默认拒绝，GIF 缩放会丢动画，原样返回。
 */

/** 必须取自 Next images.deviceSizes 默认集合，否则优化端点直接 400。 */
export type OptimizerWidth = 640 | 750 | 828 | 1080 | 1200 | 1920;

export function optimizedLocalImageUrl(url: string, width: OptimizerWidth): string {
  if (!url.startsWith("/uploads/")) return url;
  if (/\.(svg|gif)(\?|#|$)/i.test(url)) return url;
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
}
