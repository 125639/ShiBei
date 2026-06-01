import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { publicVideoWhere } from "@/lib/public-video";
import { absoluteSiteUrl } from "@/lib/site-url";

export const revalidate = 3600;
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, videos] = await Promise.all([
    prisma.post.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { updatedAt: "desc" },
      take: 1000,
      select: { slug: true, updatedAt: true }
    }),
    prisma.video.findMany({
      where: publicVideoWhere,
      orderBy: { updatedAt: "desc" },
      take: 1000,
      select: { id: true, updatedAt: true }
    })
  ]);

  return [
    { url: absoluteSiteUrl("/"), lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: absoluteSiteUrl("/posts"), lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: absoluteSiteUrl("/videos"), lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: absoluteSiteUrl("/stats"), lastModified: new Date(), changeFrequency: "daily", priority: 0.5 },
    { url: absoluteSiteUrl("/about"), lastModified: new Date(), changeFrequency: "monthly", priority: 0.4 },
    ...posts.map((post) => ({
      url: absoluteSiteUrl(`/posts/${post.slug}`),
      lastModified: post.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8
    })),
    ...videos.map((video) => ({
      url: absoluteSiteUrl(`/videos/${video.id}`),
      lastModified: video.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.5
    }))
  ];
}
