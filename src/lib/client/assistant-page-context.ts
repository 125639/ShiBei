import type { ReactNode } from "react";
import type { AssistantSuggestionGroup } from "@/components/AiAssistant";

/**
 * 页面 → 全站 AI 助手的上下文通道。
 *
 * SiteAssistant 在 PublicShell 挂载一次、跨路由常驻；具体页面（首页、文章页…）
 * 用 <AssistantPageContext> 注册自己的语料与建议问题，卸载时自动还原。
 * 未注册的页面由 SiteAssistant 按路由给出兜底上下文。
 */
export type AssistantPageContextValue = {
  context: string;
  contextLabel?: ReactNode;
  suggestionGroups?: AssistantSuggestionGroup[];
};

let current: AssistantPageContextValue | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setAssistantPageContext(value: AssistantPageContextValue): () => void {
  current = value;
  emit();
  return () => {
    if (current === value) {
      current = null;
      emit();
    }
  };
}

export function subscribeAssistantPageContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAssistantPageContext(): AssistantPageContextValue | null {
  return current;
}

export function getServerAssistantPageContext(): AssistantPageContextValue | null {
  return null;
}
