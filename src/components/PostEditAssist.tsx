"use client";

import { useState } from "react";
import { I18nText } from "./I18nText";

type RevisionResult = {
  title?: string;
  summary?: string;
  content: string;
};

type Scope = "content" | "full";

// 常用调整指令预设：点一下即可运行，也可以在输入框自行修改。
const PRESETS: Array<{ zh: string; en: string; instruction: string; scope: Scope }> = [
  { zh: "润色全文", en: "Polish", instruction: "润色全文：改善行文流畅度与用词，消除翻译腔，保持原意与篇幅。", scope: "content" },
  { zh: "修正错别字与语病", en: "Fix typos", instruction: "只修正错别字、标点误用和明显语病，不改写句式与内容。", scope: "content" },
  { zh: "精简篇幅", en: "Shorten", instruction: "在保留全部关键事实的前提下压缩篇幅约三分之一，删除重复与冗余表述。", scope: "content" },
  { zh: "语气更正式", en: "Formal tone", instruction: "把语气调整得更正式、克制，去掉口语化和情绪化表达。", scope: "content" },
  { zh: "优化标题与摘要", en: "Title & summary", instruction: "根据正文重新拟一个更准确吸引人的标题和 80 字以内的摘要；正文保持不变原样返回。", scope: "full" }
];

function readField(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  return el?.value ?? "";
}

/** 写回编辑框并触发 input 事件，让 DirtyAwareForm 的脏值检测感知到变更。 */
function writeField(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function PostEditAssist() {
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<Scope>("content");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RevisionResult | null>(null);
  const [applied, setApplied] = useState(false);

  async function run(instr: string, sc: Scope) {
    const text = instr.trim();
    if (!text || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    setApplied(false);
    try {
      const response = await fetch("/api/admin/posts/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: readField("title"),
          summary: readField("summary"),
          content: readField("content"),
          instruction: text,
          scope: sc
        })
      });
      const data = (await response.json().catch(() => ({}))) as RevisionResult & { error?: string };
      if (!response.ok) throw new Error(data.error || `请求失败 (HTTP ${response.status})`);
      if (!data.content) throw new Error("模型没有返回内容");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!result) return;
    writeField("content", result.content);
    if (result.title) writeField("title", result.title);
    if (result.summary) writeField("summary", result.summary);
    setApplied(true);
  }

  return (
    <section className="form-card form-stack" style={{ marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}><I18nText zh="AI 辅助调整" en="AI Edit Assist" /></h2>
      <p className="muted-block">
        <I18nText
          zh="基于上方编辑框的当前内容生成修订稿（含未保存的改动）。结果先预览，点「应用到编辑器」才会替换编辑框，之后仍需手动保存草稿。视频短代码与图片会原样保留。"
          en="Generates a revision from the editor's current (even unsaved) content. Preview first; “Apply” only fills the editor — you still save the draft yourself. Video shortcodes and images are preserved."
        />
      </p>

      <div className="meta-row" style={{ gap: 8, flexWrap: "wrap" }}>
        {PRESETS.map((preset) => (
          <button
            key={preset.zh}
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => {
              setInstruction(preset.instruction);
              setScope(preset.scope);
              void run(preset.instruction, preset.scope);
            }}
          >
            <I18nText zh={preset.zh} en={preset.en} />
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="post-assist-instruction"><I18nText zh="自定义指令" en="Custom instruction" /></label>
        <textarea
          id="post-assist-instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="例如：把第二节展开成两段，并在结尾补一段展望"
          rows={2}
        />
      </div>
      <div className="meta-row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label className="meta-row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
          <span className="muted"><I18nText zh="调整范围：" en="Scope: " /></span>
          <select value={scope} onChange={(event) => setScope(event.target.value === "full" ? "full" : "content")}>
            <option value="content">仅正文 / Body only</option>
            <option value="full">标题 + 摘要 + 正文 / Title + summary + body</option>
          </select>
        </label>
        <button
          type="button"
          className="button"
          disabled={loading || !instruction.trim()}
          aria-busy={loading}
          onClick={() => void run(instruction, scope)}
        >
          {loading ? <I18nText zh="生成中，长文可能需要一两分钟…" en="Generating, long posts may take a minute…" /> : <I18nText zh="生成修订稿" en="Generate Revision" />}
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert"><I18nText zh="调整失败：" en="Failed: " />{error}</p>
      ) : null}

      {result ? (
        <div className="form-stack" style={{ gap: 10 }}>
          {result.title ? (
            <p style={{ margin: 0 }}><strong><I18nText zh="新标题：" en="New title: " /></strong>{result.title}</p>
          ) : null}
          {result.summary ? (
            <p className="muted" style={{ margin: 0 }}><strong><I18nText zh="新摘要：" en="New summary: " /></strong>{result.summary}</p>
          ) : null}
          <div className="field">
            <label htmlFor="post-assist-preview">
              <I18nText zh={`修订稿预览（${result.content.length} 字符）`} en={`Revision preview (${result.content.length} chars)`} />
            </label>
            <textarea id="post-assist-preview" readOnly value={result.content} style={{ minHeight: 220 }} />
          </div>
          <div className="row-actions">
            <button type="button" className="button" onClick={apply} disabled={applied}>
              {applied ? <I18nText zh="✓ 已应用，请在上方保存草稿" en="✓ Applied — save the draft above" /> : <I18nText zh="应用到编辑器" en="Apply to Editor" />}
            </button>
            <button type="button" className="button secondary" onClick={() => { setResult(null); setApplied(false); }}>
              <I18nText zh="丢弃此稿" en="Discard" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
