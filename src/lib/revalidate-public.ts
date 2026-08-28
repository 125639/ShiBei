import { revalidatePath, revalidateTag } from "next/cache";
import { normalizePublicRevalidationPath } from "./internal-revalidation";

// 调用方（sync 的 pull/import 路由）传入的路径来自同步包里的 slug（仅 cleanText
// 校验长度，不限字符集）。revalidatePath 只吃规范的绝对路径；带查询串、片段、
// `..`（含 %2e 编码）或控制字符的畸形值只会让缓存失效变成空操作或抛错。这里在缓存
// 失效这个汇聚点统一收口：外来路径必须通过与内部 revalidate 端点同一套 normalize
// 白名单（decode 后仍禁遍历/换语义），畸形值直接丢弃。内置固定路径可信，直接放行。
export function revalidatePublicContent(paths: Array<string | null | undefined> = []) {
  const safeExtra = paths
    .map((path) => (path ? normalizePublicRevalidationPath(path) : null))
    .filter((path): path is string => Boolean(path));
  const allPaths = new Set([
    "/",
    "/posts",
    "/stats",
    "/feed.xml",
    "/sitemap.xml",
    ...safeExtra
  ]);
  for (const path of allPaths) revalidatePath(path);
  revalidateTag("stats", { expire: 0 });
  // 首页数据缓存（见 (public)/page.tsx getHomePageData）：内容一变立即失效。
  revalidateTag("public-content", { expire: 0 });
}
