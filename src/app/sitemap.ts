import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, withLanguagePrefix } from "@/lib/language";
import { absoluteSiteUrl } from "@/lib/site-url";

export const revalidate = 3600;
export const dynamic = "force-dynamic";

/**
 * 每条 URL 都按语种各出一条，并成对声明 hreflang alternates。
 *
 * 只列默认语种、或只列无前缀路径，英文版就永远进不了索引——那正是做路由级
 * i18n 要解决的问题。alternates.languages 让搜索引擎知道 /zh/... 与 /en/...
 * 是同一内容的不同语言版本，而不是重复内容。
 */
function localizedEntry(
  path: string,
  rest: Omit<MetadataRoute.Sitemap[number], "url" | "alternates">
): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    SUPPORTED_LANGUAGES.map((lang) => [
      lang === "zh" ? "zh-CN" : lang,
      absoluteSiteUrl(withLanguagePrefix(lang, path))
    ])
  );
  return SUPPORTED_LANGUAGES.map((lang) => ({
    ...rest,
    url: absoluteSiteUrl(withLanguagePrefix(lang, path)),
    alternates: {
      languages: {
        ...languages,
        "x-default": absoluteSiteUrl(withLanguagePrefix(DEFAULT_LANGUAGE, path))
      }
    }
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await prisma.post.findMany({
    where: { status: "PUBLISHED", publicationBlockedReason: null },
    orderBy: { updatedAt: "desc" },
    take: 1000,
    select: { slug: true, updatedAt: true }
  });

  const now = new Date();
  return [
    ...localizedEntry("/", { lastModified: now, changeFrequency: "daily", priority: 1 }),
    ...localizedEntry("/posts", { lastModified: now, changeFrequency: "daily", priority: 0.9 }),
    ...localizedEntry("/stats", { lastModified: now, changeFrequency: "daily", priority: 0.5 }),
    ...localizedEntry("/about", { lastModified: now, changeFrequency: "monthly", priority: 0.4 }),
    ...posts.flatMap((post) =>
      localizedEntry(`/posts/${post.slug}`, {
        lastModified: post.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.8
      })
    )
  ];
}
