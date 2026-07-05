"use client";

import { useEffect, useRef, useState } from "react";
import { MODEL_PROVIDER_PRESETS } from "@/lib/model-providers";
import { useUserPrefs } from "./useUserPrefs";

const STORAGE_KEY = "shibei-write-draft-v1";

type StoredDraft = {
  title: string;
  draft: string;
  instruction: string;
  savedAt: number;
};

type AssistResult = {
  output: string;
  usingCustomModel: boolean;
};

export function WritingWorkspace() {
  const { prefs, hydrated } = useUserPrefs();
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [instruction, setInstruction] = useState("润色当前文稿,并给出可以继续展开的方向。");
  // 默认「自定义」：不预选任何具体服务商，避免被误解为站点默认用某家服务。
  // 留空 + 不填 API Key 时走管理员在后台配置的默认模型。
  const [provider, setProvider] = useState("custom");
  const preset = MODEL_PROVIDER_PRESETS.find((item) => item.key === provider) || MODEL_PROVIDER_PRESETS[0];
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl);
  const [model, setModel] = useState(preset.model);
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<AssistResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState<StoredDraft | null>(null);
  const restoredRef = useRef(false);

  // 写作页面本身不持久化到数据库;为了避免误关浏览器丢失内容,把 title/draft/instruction
  // 同步到 localStorage,下次再打开时可一键恢复。
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<StoredDraft>;
      if ((data.title || data.draft) && typeof data.savedAt === "number") {
        setRestored({
          title: String(data.title || ""),
          draft: String(data.draft || ""),
          instruction: String(data.instruction || ""),
          savedAt: data.savedAt
        });
      }
    } catch {
      /* ignore parse errors */
    }
  }, []);

  useEffect(() => {
    if (!title && !draft) return;
    const id = window.setTimeout(() => {
      try {
        const payload: StoredDraft = {
          title,
          draft,
          instruction,
          savedAt: Date.now()
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* quota errors are non-fatal for the in-memory draft */
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [title, draft, instruction]);

  function changeProvider(next: string) {
    setProvider(next);
    const nextPreset = MODEL_PROVIDER_PRESETS.find((item) => item.key === next);
    if (!nextPreset) return;
    setBaseUrl(nextPreset.baseUrl);
    setModel(nextPreset.model);
  }

  async function requestAssist(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/public/writing/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          draft,
          instruction,
          language: hydrated ? prefs.language : "zh",
          customModel: apiKey.trim()
            ? {
                baseUrl,
                model,
                apiKey,
                temperature: 0.4,
                maxTokens: 2200
              }
            : null
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI writing request failed");
      setResult({ output: String(data.output || ""), usingCustomModel: Boolean(data.usingCustomModel) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function insertResult() {
    if (!result?.output) return;
    setDraft((current) => `${current}${current ? "\n\n" : ""}${result.output}`);
  }

  function downloadDraft() {
    const safeTitle = (title.trim() || "shibei-writing").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
    const blob = new Blob([`# ${title.trim() || "未命名文稿"}\n\n${draft}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeTitle}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="writing-layout">
      <section className="form-card form-stack writing-editor">
        <h2>我的文稿</h2>
        {restored ? (
          <div className="restore-banner" role="status">
            <span>
              发现 {new Date(restored.savedAt).toLocaleString("zh-CN")} 的未完成稿件。
            </span>
            <div className="row-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  // 用户可能已开始新的输入；恢复会覆盖当前内容，先确认。
                  if ((title.trim() || draft.trim()) && !window.confirm("恢复旧稿会覆盖当前已输入的内容，确定继续吗？")) {
                    return;
                  }
                  setTitle(restored.title);
                  setDraft(restored.draft);
                  if (restored.instruction) setInstruction(restored.instruction);
                  setRestored(null);
                }}
              >
                恢复
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setRestored(null);
                  window.localStorage.removeItem(STORAGE_KEY);
                }}
              >
                丢弃
              </button>
            </div>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="writingTitle">标题</label>
          <input id="writingTitle" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给你的文稿起个标题" />
        </div>
        <div className="field">
          <label htmlFor="writingDraft">正文 Markdown</label>
          <textarea
            id="writingDraft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="在这里写作。内容只保存在当前浏览器页面，不会进入博客。"
            style={{ minHeight: 520 }}
          />
        </div>
        <div className="row between">
          <span className="muted">约 {draft.length} 字符</span>
          <button className="button secondary" type="button" onClick={downloadDraft} disabled={!draft.trim() && !title.trim()}>下载 Markdown</button>
        </div>
      </section>

      <form className="form-card form-stack writing-ai" onSubmit={requestAssist}>
        <h2>AI 辅助写作</h2>
        <p className="muted-block">
          填入自己的模型 API Key 时，将使用你的模型；不填写时使用管理员为用户写作配置的模型。本站不会保存这里的文稿或自定义 Key。
        </p>
        <div className="field">
          <label htmlFor="writingInstruction">给 AI 的要求</label>
          <textarea id="writingInstruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="writingProvider">自定义模型服务商（可选）</label>
          <select id="writingProvider" value={provider} onChange={(event) => changeProvider(event.target.value)}>
            {MODEL_PROVIDER_PRESETS.map((item) => (
              <option key={item.key} value={item.key}>{item.model ? `${item.label} · ${item.model}` : item.label}</option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="writingBaseUrl">Base URL</label>
            <input id="writingBaseUrl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1（配合自己的 Key 使用）" />
          </div>
          <div className="field">
            <label htmlFor="writingModel">Model</label>
            <input id="writingModel" value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型名，如 gpt-4o-mini" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="writingApiKey">API Key（可选）</label>
          <input id="writingApiKey" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="留空则使用管理员配置" />
        </div>
        <button className="button" type="submit" aria-busy={loading} disabled={loading || (!draft.trim() && !instruction.trim())}>{loading ? "生成中…" : "请求 AI 辅助"}</button>
        {error ? <p className="muted-block creation-error" role="alert">请求失败：{error}</p> : null}
        {result ? (
          <div className="assistant-result">
            <div className="meta-row">
              <span className="tag">{result.usingCustomModel ? "使用用户模型" : "使用管理员模型"}</span>
            </div>
            <pre>{result.output}</pre>
            <button className="button secondary" type="button" onClick={insertResult}>插入到文稿末尾</button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
