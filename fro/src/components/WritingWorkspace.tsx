"use client";

import { useState } from "react";
import { MODEL_PROVIDER_PRESETS } from "@/lib/model-providers";
import { useUserPrefs } from "./useUserPrefs";

type AssistResult = {
  output: string;
  usingCustomModel: boolean;
};

export function WritingWorkspace() {
  const { prefs, hydrated } = useUserPrefs();
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [instruction, setInstruction] = useState("润色当前文稿，并给出可以继续展开的方向。");
  const [provider, setProvider] = useState("canopywave");
  const preset = MODEL_PROVIDER_PRESETS.find((item) => item.key === provider) || MODEL_PROVIDER_PRESETS[0];
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl);
  const [model, setModel] = useState(preset.model);
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<AssistResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
              <option key={item.key} value={item.key}>{item.label} · {item.model}</option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="writingBaseUrl">Base URL</label>
            <input id="writingBaseUrl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="writingModel">Model</label>
            <input id="writingModel" value={model} onChange={(event) => setModel(event.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="writingApiKey">API Key（可选）</label>
          <input id="writingApiKey" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="留空则使用管理员配置" />
        </div>
        <button className="button" type="submit" disabled={loading || (!draft.trim() && !instruction.trim())}>{loading ? "生成中…" : "请求 AI 辅助"}</button>
        {error ? <p className="muted-block">请求失败：{error}</p> : null}
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
