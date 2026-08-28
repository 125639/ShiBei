"use client";

import { useEffect, useState } from "react";

type MarkdownModule = typeof import("@/lib/markdown");

// 模块级单例：多个组件同时需要时只触发一次 chunk 下载。
let markdownModulePromise: Promise<MarkdownModule> | null = null;

function loadMarkdownModule() {
  markdownModulePromise ??= import("@/lib/markdown");
  return markdownModulePromise;
}

/**
 * 客户端懒加载 Markdown 渲染。
 *
 * 背景：marked + DOMPurify 合计 ~25KB gzip，公开文章页曾是全站流量最大的路由，
 * 之前为了渲染正文把它们静态打进了每个访客的首屏 bundle。现在正文默认由服务端
 * 预渲染（见 posts/[slug]/page.tsx），只有「翻译在客户端动态到达」「手动点预览」
 * 这类少数场景才真正需要在浏览器里解析——本 hook 用 dynamic import 把解析器
 * 变成按需 chunk：纯中文读者、以及英文版已缓存的文章，一个字节的解析器代码
 * 都不用下载。
 *
 * 返回 null 表示「暂无可用 HTML」：markdown 为 null（不需要渲染），或新输入的
 * 解析还在进行中。调用方据此渲染占位态。setState 只出现在异步回调里，输入
 * 变化后旧结果靠 `parsed.input === markdown` 派生失效，不产生同步重渲染。
 */
export function useMarkdownHtml(
  markdown: string | null,
  videosById?: Map<string, import("@/lib/markdown").VideoForShortcode>,
  hideVideos = false
): string | null {
  const [parsed, setParsed] = useState<{ input: string; html: string } | null>(null);

  useEffect(() => {
    if (markdown === null) return;
    let cancelled = false;
    void loadMarkdownModule().then(({ markdownToHtml }) => {
      if (!cancelled) setParsed({ input: markdown, html: markdownToHtml(markdown, { videosById, hideVideos }) });
    });
    return () => {
      cancelled = true;
    };
  }, [markdown, videosById, hideVideos]);

  return parsed !== null && parsed.input === markdown ? parsed.html : null;
}
