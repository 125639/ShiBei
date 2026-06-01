import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCachedSiteChromeSettings } from "@/lib/site-settings-cache";
import { absoluteSiteUrl } from "@/lib/site-url";

export const revalidate = 900;
export const dynamic = "force-dynamic";

export async function GET() {
  const [settings, posts] = await Promise.all([
    getCachedSiteChromeSettings().catch(() => null),
    prisma.post.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
      take: 50,
      select: { slug: true, title: true, summary: true, publishedAt: true, updatedAt: true }
    })
  ]);

  const title = settings?.name || "ShiBei";
  const description = settings?.description || "抓取、整理、发布信息";
  const siteUrl = absoluteSiteUrl("/");
  const latestDate = posts[0]?.publishedAt || posts[0]?.updatedAt || new Date();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${escapeXml(title)}</title>`,
    `<link>${escapeXml(siteUrl)}</link>`,
    `<description>${escapeXml(description)}</description>`,
    `<language>zh-CN</language>`,
    `<lastBuildDate>${latestDate.toUTCString()}</lastBuildDate>`,
    `<atom:link href="${escapeXml(absoluteSiteUrl("/feed.xml"))}" rel="self" type="application/rss+xml" />`,
    ...posts.map((post) => {
      const url = absoluteSiteUrl(`/posts/${post.slug}`);
      const date = post.publishedAt || post.updatedAt;
      return [
        "<item>",
        `<title>${escapeXml(post.title)}</title>`,
        `<link>${escapeXml(url)}</link>`,
        `<guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `<description>${escapeXml(post.summary)}</description>`,
        `<pubDate>${date.toUTCString()}</pubDate>`,
        "</item>"
      ].join("");
    }),
    "</channel>",
    "</rss>"
  ].join("");

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600"
    }
  });
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
