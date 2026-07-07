import { revalidatePath, revalidateTag } from "next/cache";

export function revalidatePublicContent(paths: Array<string | null | undefined> = []) {
  const allPaths = new Set([
    "/",
    "/posts",
    "/stats",
    "/feed.xml",
    "/sitemap.xml",
    ...paths.filter((path): path is string => Boolean(path))
  ]);
  for (const path of allPaths) revalidatePath(path);
  revalidateTag("stats");
  // 首页数据缓存（见 (public)/page.tsx getHomePageData）：内容一变立即失效。
  revalidateTag("public-content");
}
