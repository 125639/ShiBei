import { revalidatePath, revalidateTag } from "next/cache";

export function revalidatePublicContent(paths: Array<string | null | undefined> = []) {
  const allPaths = new Set([
    "/",
    "/posts",
    "/videos",
    "/stats",
    "/feed.xml",
    "/sitemap.xml",
    ...paths.filter((path): path is string => Boolean(path))
  ]);
  for (const path of allPaths) revalidatePath(path);
  revalidateTag("stats");
}
