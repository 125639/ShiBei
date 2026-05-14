"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useUserPrefs } from "./useUserPrefs";
import { I18nText } from "./I18nText";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantSuggestionGroup = {
  title: ReactNode;
  prompts: string[];
};

function renderInlineMarkdown(text: string) {
  const nodes: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2]) {
      nodes.push(<strong key={`b-${match.index}`}>{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(<code key={`c-${match.index}`}>{match[3]}</code>);
    } else if (match[4] && match[5]) {
      nodes.push(
        <a key={`a-${match.index}`} className="text-link" href={match[5]} target="_blank" rel="noreferrer">
          {match[4]}
        </a>
      );
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function AssistantMessageContent({ content }: { content: string }) {
  const blocks = content.trim().split(/\n{2,}/).filter(Boolean);
  if (!blocks.length) return null;

  return (
    <div className="assistant-message-content">
      {blocks.map((block, blockIndex) => {
        const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
        const isList = lines.length > 1 && lines.every((line) => /^[-*]\s+/.test(line));
        if (isList) {
          return (
            <ul key={`block-${blockIndex}`}>
              {lines.map((line, lineIndex) => (
                <li key={`line-${lineIndex}`}>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={`block-${blockIndex}`}>
            {lines.map((line, lineIndex) => (
              <span key={`line-${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderInlineMarkdown(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const DEFAULT_SUGGESTION_GROUPS: AssistantSuggestionGroup[] = [
  {
    title: <I18nText zh="近期热点" en="Quick Reads" />,
    prompts: [
      "帮我概括这一页的重点",
      "这里有哪些值得继续追问的问题？",
      "用更通俗的话解释给我听"
    ]
  },
  {
    title: <I18nText zh="推荐解决方案" en="Useful Angles" />,
    prompts: [
      "列出事实、观点和不确定信息",
      "这件事可能带来什么影响？",
      "帮我拟一个评论角度"
    ]
  }
];

export function AiAssistant({
  context,
  contextLabel = <I18nText zh="当前页面" en="Current Page" />,
  suggestionGroups = DEFAULT_SUGGESTION_GROUPS
}: {
  context: string;
  contextLabel?: ReactNode;
  suggestionGroups?: AssistantSuggestionGroup[];
}) {
  const { prefs, hydrated } = useUserPrefs();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 720px)").matches;
    setOpen(!compact);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!open || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, loading, open]);

  async function sendMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || loading) return;

    setInput("");
    setOpen(true);
    setError("");
    setMessages((current) => [...current, { role: "user", content: message }]);
    setLoading(true);
    try {
      const response = await fetch("/api/public/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          context,
          language: hydrated ? prefs.language : "zh"
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI assistant failed");
      setMessages((current) => [...current, { role: "assistant", content: String(data.reply || "") }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await sendMessage(input);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <aside
      className={`ai-assistant-dock${open ? " open" : ""}${ready ? " ready" : ""}`}
      aria-label={hydrated && prefs.language === "en" ? "AI Assistant" : "AI 助手"}
    >
      <button
        className="ai-assistant-launcher"
        type="button"
        aria-expanded={open}
        aria-controls="ai-assistant-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden>AI</span>
        <strong><I18nText zh="助手" en="Assistant" /></strong>
      </button>

      <section className="ai-assistant-panel" id="ai-assistant-panel">
        <div className="ai-assistant-topbar">
          <div>
            <p className="eyebrow">AI Assistant</p>
            <h2><I18nText zh="拾贝 AI 助手" en="ShiBei AI Assistant" /></h2>
          </div>
          <div className="ai-assistant-window-actions">
            <span className="tag">{contextLabel}</span>
            <button
              type="button"
              className="ai-assistant-icon-button"
              aria-label={hydrated && prefs.language === "en" ? "Close assistant" : "关闭助手"}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
        </div>

        <div className="assistant-chat-log" ref={logRef}>
          {messages.length === 0 ? (
            <div className="assistant-welcome">
              <span className="assistant-spark" aria-hidden>*</span>
              <h3>
                <I18nText zh="你好，我是" en="Hello, I am" />{" "}
                <strong><I18nText zh="拾贝 AI 助手" en="ShiBei AI" /></strong>
              </h3>
              <p>
                <I18nText
                  zh="可以问我这页内容的背景、重点、争议，也可以让我帮你整理阅读路径。"
                  en="Ask about the context, highlights, controversies, or a clearer reading path for this page."
                />
              </p>
              <div className="assistant-suggestion-grid">
                {suggestionGroups.map((group, groupIndex) => (
                  <div className="assistant-suggestion-card" key={`group-${groupIndex}`}>
                    <h4>{group.title}</h4>
                    {group.prompts.map((prompt) => (
                      <button
                        type="button"
                        key={prompt}
                        onClick={() => void sendMessage(prompt)}
                        disabled={loading}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : messages.map((message, index) => (
            <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}>
              <strong>{message.role === "user" ? <I18nText zh="你" en="You" /> : "AI"}</strong>
              <AssistantMessageContent content={message.content} />
            </div>
          ))}
          {loading ? <p className="muted-block"><I18nText zh="AI 正在思考..." en="AI is thinking..." /></p> : null}
          {error ? <p className="muted-block"><I18nText zh={`请求失败：${error}`} en={`Request failed: ${error}`} /></p> : null}
        </div>

        <form className="assistant-input-row" onSubmit={submit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={hydrated && prefs.language === "en" ? "Tell me what you want to know. Shift + Enter for a new line." : "请将您遇到的问题告诉我，使用 Shift + Enter 换行"}
            aria-label={hydrated && prefs.language === "en" ? "AI Assistant Input" : "AI 助手输入"}
            rows={3}
          />
          <div className="assistant-input-footer">
            <span><I18nText zh="内容由 AI 生成，仅供参考。" en="AI-generated content is for reference only." /></span>
            <button className="button" type="submit" disabled={loading || !input.trim()} aria-label={hydrated && prefs.language === "en" ? "Send" : "发送"}>
              ↑
            </button>
          </div>
        </form>
      </section>
    </aside>
  );
}
