"use client";

import { useState } from "react";
import { useUserPrefs } from "./useUserPrefs";
import { I18nText } from "./I18nText";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
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

export function AiAssistant({ context, contextLabel = <I18nText zh="当前页面" en="Current Page" /> }: { context: string; contextLabel?: React.ReactNode }) {
  const { prefs, hydrated } = useUserPrefs();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;
    setInput("");
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

  return (
    <section className="ai-assistant-panel" aria-label={hydrated && prefs.language === 'en' ? "AI Assistant" : "AI 助手"}>
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">AI Assistant</p>
          <h2><I18nText zh="AI 助手" en="AI Assistant" /></h2>
        </div>
        <span className="tag">{contextLabel}</span>
      </div>
      <div className="assistant-chat-log">
        {messages.length === 0 ? (
          <p className="muted-block"><I18nText zh="可以问我这页新闻的背景、重点、争议，也可以让我帮你拟一个评论角度。" en="You can ask me about the background, highlights, or controversies of this news, or ask me to draft a commentary angle." /></p>
        ) : messages.map((message, index) => (
          <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}>
            <strong>{message.role === "user" ? <I18nText zh="你" en="You" /> : "AI"}</strong>
            <AssistantMessageContent content={message.content} />
          </div>
        ))}
        {loading ? <p className="muted-block"><I18nText zh="AI 正在思考…" en="AI is thinking..." /></p> : null}
        {error ? <p className="muted-block"><I18nText zh={`请求失败：${error}`} en={`Request failed: ${error}`} /></p> : null}
      </div>
      <form className="assistant-input-row" onSubmit={submit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={hydrated && prefs.language === 'en' ? "Ask about this page, or chat..." : "询问这页内容，或继续聊天…"}
          aria-label={hydrated && prefs.language === 'en' ? "AI Assistant Input" : "AI 助手输入"}
        />
        <button className="button" type="submit" disabled={loading || !input.trim()}><I18nText zh="发送" en="Send" /></button>
      </form>
    </section>
  );
}
