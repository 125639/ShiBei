"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { AiAssistant, type AssistantSuggestionGroup } from "@/components/AiAssistant";
import { I18nText } from "@/components/I18nText";
import {
  getAssistantPageContext,
  getServerAssistantPageContext,
  subscribeAssistantPageContext
} from "@/lib/client/assistant-page-context";

type SectionFallback = {
  label: { zh: string; en: string };
  hint: string;
  prompts?: string[];
};

/** 按路由前缀的兜底上下文；具体页面注册的上下文永远优先。 */
const SECTION_FALLBACKS: Array<{ match: (path: string) => boolean } & SectionFallback> = [
  {
    match: (p) => p === "/",
    label: { zh: "博客主页", en: "Home" },
    hint: "访客正在浏览博客主页。"
  },
  {
    match: (p) => p.startsWith("/posts/"),
    label: { zh: "文章页", en: "Article" },
    hint: "访客正在阅读一篇文章。",
    prompts: ["概括这篇文章的重点", "列出文中的事实与观点", "这篇文章有哪些值得追问的问题？"]
  },
  {
    match: (p) => p.startsWith("/posts"),
    label: { zh: "文章列表", en: "Posts" },
    hint: "访客正在浏览文章列表，可以协助筛选主题、解释分类或推荐阅读顺序。",
    prompts: ["这个博客都有哪些板块？", "帮我推荐一个开始阅读的方向", "最近哪些话题更新得多？"]
  },
  {
    match: (p) => p.startsWith("/community"),
    label: { zh: "读者社区", en: "Community" },
    hint: "访客正在浏览读者共创社区（读者用 AI 访谈写成并公开的作品）。",
    prompts: ["共创社区是怎么运作的？", "我也想发一篇，该从哪开始？", "公开作品前会经过什么检查？"]
  },
  {
    match: (p) => p.startsWith("/create"),
    label: { zh: "共创工作室", en: "Co-create" },
    hint: "访客正在共创工作室（AI 访谈式写作：选题材与深度，回答问题后生成可编辑文章）。",
    prompts: ["快速成文和深度成文有什么区别？", "帮我想一个适合写的主题", "评分标尺是怎么算的？"]
  },
  {
    match: (p) => p.startsWith("/write"),
    label: { zh: "写作台", en: "Writing" },
    hint: "访客正在个人写作台（自由写作，可选 AI 辅助）。",
    prompts: ["帮我把一个想法整理成提纲", "给我一个开头的写法建议", "怎么让文章结构更清楚？"]
  },
  {
    match: (p) => p.startsWith("/stats"),
    label: { zh: "内容数据", en: "Stats" },
    hint: "访客正在查看站点的内容统计数据页。",
    prompts: ["这些统计数字说明了什么？", "内容主要集中在哪些方向？"]
  },
  {
    match: (p) => p.startsWith("/about"),
    label: { zh: "关于本站", en: "About" },
    hint: "访客正在查看关于页。",
    prompts: ["这个站点是做什么的？", "内容是怎么生产和审核的？"]
  }
];

/**
 * 全站常驻的 AI 助手。挂在 PublicShell（layout 级），跨路由保持对话不丢。
 * 页面注册的上下文优先；否则按路由前缀给兜底说明，保证任何页面都能用。
 */
export function SiteAssistant({ siteName, siteDescription }: { siteName: string; siteDescription: string }) {
  const pathname = usePathname() || "/";
  const registered = useSyncExternalStore(
    subscribeAssistantPageContext,
    getAssistantPageContext,
    getServerAssistantPageContext
  );

  if (pathname.startsWith("/admin")) return null;

  if (registered) {
    return (
      <AiAssistant
        context={registered.context}
        contextLabel={registered.contextLabel}
        suggestionGroups={registered.suggestionGroups}
      />
    );
  }

  const section = SECTION_FALLBACKS.find((item) => item.match(pathname));
  const label = section?.label ?? { zh: "当前页面", en: "Current Page" };
  const context = [
    `站点：${siteName} —— ${siteDescription}`,
    section?.hint ?? "访客正在浏览站点页面。",
    `当前路径：${pathname}`
  ].join("\n");
  const suggestionGroups: AssistantSuggestionGroup[] | undefined = section?.prompts
    ? [{ title: <I18nText zh="可以问我" en="Try asking" />, prompts: section.prompts }]
    : undefined;

  return (
    <AiAssistant
      context={context}
      contextLabel={<I18nText zh={label.zh} en={label.en} />}
      suggestionGroups={suggestionGroups}
    />
  );
}
