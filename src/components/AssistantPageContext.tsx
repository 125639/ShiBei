"use client";

import { useEffect, type ReactNode } from "react";
import type { AssistantSuggestionGroup } from "@/components/AiAssistant";
import { setAssistantPageContext } from "@/lib/client/assistant-page-context";

/**
 * 在页面里声明该页给全站 AI 助手的上下文。渲染为 null，不产生任何 DOM。
 * 服务端组件可以直接使用（把标题/摘要/正文摘录拼成 context 字符串传入）。
 */
export function AssistantPageContext({
  context,
  contextLabel,
  suggestionGroups
}: {
  context: string;
  contextLabel?: ReactNode;
  suggestionGroups?: AssistantSuggestionGroup[];
}) {
  useEffect(() => {
    return setAssistantPageContext({ context, contextLabel, suggestionGroups });
    // 标签与建议列表跟随页面内容整体变化；仅以 context 文本为变更信号，
    // 避免父组件重渲染时因对象身份变化反复重注册。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  return null;
}
