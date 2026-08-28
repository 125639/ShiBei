import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { absoluteSiteUrl } from "@/lib/site-url";

export const revalidate = 3600;
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await prisma.post.findMany({
    where: { status: "PUBLISHED", publicationBlockedReason: null },
    orderBy: { updatedAt: "desc" },
    take: 1000,
    select: { slug: true, updatedAt: true }
  });

  return [
    { url: absoluteSiteUrl("/"), lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: absoluteSiteUrl("/posts"), lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: absoluteSiteUrl("/stats"), lastModified: new Date(), changeFrequency: "daily", priority: 0.5 },
    { url: absoluteSiteUrl("/about"), lastModified: new Date(), changeFrequency: "monthly", priority: 0.4 },
    ...posts.map((post) => ({
      url: absoluteSiteUrl(`/posts/${post.slug}`),
      lastModified: post.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8
    }))
  ];
}
