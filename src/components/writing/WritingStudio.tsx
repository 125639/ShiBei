"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { MODEL_PROVIDER_PRESETS } from "@/lib/model-providers";
import { markdownToHtml } from "@/lib/markdown";
import { NotionEditor, type AiSelectionKind, type AiSelectionRequest } from "./NotionEditor";

type DocMeta = { id: string; title: string; updatedAt: string };
type DocFull = DocMeta & { content: string };

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

type AiTask = {
  mode: "selection" | "continue";
  kind: AiSelectionKind | "continue";
  label: string;
  source: string;
  from: number;
  to: number;
  status: "loading" | "done" | "error";
  output: string;
  error: string;
};

const LEGACY_DRAFT_KEY = "shibei-write-draft-v1";
const MODEL_KEY = "shibei-write-model-v2";

const AI_INSTRUCTIONS: Record<AiSelectionKind, { label: string; instruction: string }> = {
  polish: {
    label: "润色",
    instruction: "润色【当前文稿】中的文字：保持原意与原语言，改善表达、流畅度与节奏。只输出润色后的文本（markdown），不要任何解释、前言或引号包裹。"
  },
  shorten: {
    label: "精简",
    instruction: "把【当前文稿】中的文字压缩到大约一半长度：保留关键信息与语气，删去冗余。只输出精简后的文本，不要解释。"
  },
  expand: {
    label: "扩写",
    instruction: "把【当前文稿】中的文字扩写得更充实：补充细节、例证或过渡，保持原语言与风格。只输出扩写后的文本，不要解释。"
  },
  fix: {
    label: "纠错",
    instruction: "修正【当前文稿】中的错别字、标点与语法问题，不改变表达风格与语言。只输出修正后的全文，不要解释、不要列出修改点。"
  },
  translate: {
    label: "译英",
    instruction: "把【当前文稿】中的文字翻译成地道、自然的英文。只输出英文译文，不要解释。"
  }
};

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(iso).toLocaleDateString();
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `请求失败（${response.status}）`);
  return data as T;
}

export function WritingStudio() {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [active, setActive] = useState<DocFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string>("");
  const [fatal, setFatal] = useState("");
  const [ai, setAi] = useState<AiTask | null>(null);

  // 自定义模型(可选;默认走站点模型)
  const [provider, setProvider] = useState("custom");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  const editorRef = useRef<Editor | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingRef = useRef<{ title: string; content: string } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string>("");

  const wordCount = useMemo(() => {
    const text = (active?.content || "").replace(/\s+/g, "");
    return text.length;
  }, [active?.content]);

  // —— 模型偏好持久化(不存 key) ——
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MODEL_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { provider?: string; baseUrl?: string; model?: string };
      if (saved.provider) setProvider(saved.provider);
      if (saved.baseUrl) setBaseUrl(saved.baseUrl);
      if (saved.model) setModel(saved.model);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(MODEL_KEY, JSON.stringify({ provider, baseUrl, model }));
    } catch { /* ignore */ }
  }, [provider, baseUrl, model]);

  const applyProviderPreset = (key: string) => {
    setProvider(key);
    const preset = MODEL_PROVIDER_PRESETS.find((item) => item.key === key);
    if (preset && preset.baseUrl) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  };

  // —— 初始化:拉列表;空则迁移旧草稿或新建 ——
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { docs: list } = await requestJson<{ docs: DocMeta[] }>("/api/public/writing/docs");
        if (cancelled) return;
        if (list.length) {
          setDocs(list);
          await openDoc(list[0].id, list);
        } else {
          let legacy: { title?: string; draft?: string } | null = null;
          try {
            const raw = window.localStorage.getItem(LEGACY_DRAFT_KEY);
            if (raw) legacy = JSON.parse(raw) as { title?: string; draft?: string };
          } catch { /* ignore */ }
          const created = await requestJson<{ doc: DocFull }>("/api/public/writing/docs", { method: "POST" });
          if (legacy && (legacy.title || legacy.draft)) {
            await requestJson(`/api/public/writing/docs/${created.doc.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: legacy.title || "", content: legacy.draft || "" })
            });
            created.doc.title = legacy.title || "";
            created.doc.content = legacy.draft || "";
            try { window.localStorage.removeItem(LEGACY_DRAFT_KEY); } catch { /* ignore */ }
          }
          if (cancelled) return;
          setDocs([{ id: created.doc.id, title: created.doc.title, updatedAt: created.doc.updatedAt }]);
          setActive(created.doc);
          activeIdRef.current = created.doc.id;
        }
      } catch (err) {
        if (!cancelled) setFatal(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushSave = useCallback(async (docId?: string) => {
    const id = docId || activeIdRef.current;
    const pending = pendingRef.current;
    if (!id || !pending) return;
    pendingRef.current = null;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    setSaveState("saving");
    try {
      const { doc } = await requestJson<{ doc: DocMeta }>(`/api/public/writing/docs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending)
      });
      setSaveState("saved");
      setSavedAt(doc.updatedAt);
      // 最近编辑的文档置顶,与 Notion 侧栏习惯一致
      setDocs((current) => {
        const updated = current.map((item) =>
          item.id === id ? { ...item, title: pending.title, updatedAt: doc.updatedAt } : item
        );
        const target = updated.find((item) => item.id === id);
        return target ? [target, ...updated.filter((item) => item.id !== id)] : updated;
      });
    } catch {
      pendingRef.current = pending; // 保留待存内容,下次重试
      setSaveState("error");
    }
  }, []);

  const scheduleSave = useCallback((title: string, content: string) => {
    pendingRef.current = { title, content };
    setSaveState("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void flushSave(); }, 1200);
  }, [flushSave]);

  const openDoc = useCallback(async (id: string, list?: DocMeta[]) => {
    await flushSave();
    try {
      const { doc } = await requestJson<{ doc: DocFull }>(`/api/public/writing/docs/${id}`);
      setActive(doc);
      activeIdRef.current = doc.id;
      setSaveState("idle");
      setSavedAt(doc.updatedAt);
      setAi(null);
      setListOpen(false);
      if (list) setDocs(list);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    }
  }, [flushSave]);

  const createDoc = useCallback(async () => {
    await flushSave();
    try {
      const { doc } = await requestJson<{ doc: DocFull }>("/api/public/writing/docs", { method: "POST" });
      setDocs((current) => [{ id: doc.id, title: doc.title, updatedAt: doc.updatedAt }, ...current]);
      setActive(doc);
      activeIdRef.current = doc.id;
      setSaveState("idle");
      setSavedAt(doc.updatedAt);
      setAi(null);
      setTimeout(() => titleRef.current?.focus(), 50);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    }
  }, [flushSave]);

  const deleteDoc = useCallback(async (id: string) => {
    const target = docs.find((item) => item.id === id);
    if (!window.confirm(`删除「${target?.title || "无标题"}」？此操作不可恢复。`)) return;
    try {
      await requestJson(`/api/public/writing/docs/${id}`, { method: "DELETE" });
      const rest = docs.filter((item) => item.id !== id);
      setDocs(rest);
      if (activeIdRef.current === id) {
        pendingRef.current = null;
        if (rest.length) await openDoc(rest[0].id);
        else await createDoc();
      }
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    }
  }, [docs, openDoc, createDoc]);

  // 卸载前尽力保存
  useEffect(() => {
    const handler = () => {
      const id = activeIdRef.current;
      const pending = pendingRef.current;
      if (!id || !pending) return;
      try {
        navigator.sendBeacon?.(
          `/api/public/writing/docs/${id}`,
          new Blob([JSON.stringify(pending)], { type: "application/json" })
        );
      } catch { /* ignore */ }
    };
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, []);

  // —— AI ——
  const customModel = apiKey.trim() && baseUrl.trim() && model.trim()
    ? { baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() }
    : null;

  const runAi = useCallback(async (task: Omit<AiTask, "status" | "output" | "error">) => {
    setAi({ ...task, status: "loading", output: "", error: "" });
    try {
      const instruction = task.mode === "continue"
        ? "从【当前文稿】的结尾自然续写 1-3 段：保持既有语言、口吻与 markdown 格式。只输出续写的新内容，不要重复原文，不要解释。"
        : AI_INSTRUCTIONS[task.kind as AiSelectionKind].instruction;
      const draft = task.mode === "continue"
        ? `${active?.title ? `# ${active.title}\n\n` : ""}${(active?.content || "").slice(-8000)}`
        : task.source;
      const { output } = await requestJson<{ output: string }>("/api/public/writing/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: active?.title || "", draft, instruction, language: "zh", customModel })
      });
      setAi((current) => current && current.mode === task.mode ? { ...current, status: "done", output: output.trim() } : current);
    } catch (err) {
      setAi((current) => current ? { ...current, status: "error", error: err instanceof Error ? err.message : String(err) } : current);
    }
  }, [active?.title, active?.content, customModel]);

  const onAiSelection = useCallback((request: AiSelectionRequest) => {
    void runAi({
      mode: "selection",
      kind: request.kind,
      label: AI_INSTRUCTIONS[request.kind].label,
      source: request.text,
      from: request.from,
      to: request.to
    });
  }, [runAi]);

  const onAiContinue = useCallback(() => {
    void runAi({ mode: "continue", kind: "continue", label: "续写", source: "", from: 0, to: 0 });
  }, [runAi]);

  const insertAiOutput = (strategy: "replace" | "below") => {
    const editor = editorRef.current;
    if (!editor || !ai || ai.status !== "done" || !ai.output) return;
    // tiptap-markdown 接管了 insertContent 的字符串解析:直接喂 markdown,
    // 粗体/列表/标题等按富文本落进文档(与全站存储格式一致)。
    const markdown = ai.output;
    if (ai.mode === "selection" && strategy === "replace") {
      editor.chain().focus().deleteRange({ from: ai.from, to: ai.to }).insertContentAt(ai.from, markdown).run();
    } else if (ai.mode === "selection") {
      editor.chain().focus().insertContentAt(ai.to, markdown).run();
    } else {
      editor.chain().focus("end").insertContentAt(editor.state.doc.content.size, markdown).run();
    }
    setAi(null);
  };

  if (loading) {
    return <div className="writing-studio writing-loading" aria-busy="true"><p className="muted">正在打开写作台…</p></div>;
  }
  if (fatal && !active) {
    return <div className="writing-studio"><p className="form-error" role="alert">{fatal}</p></div>;
  }
  if (!active) return null;

  const saveLabel =
    saveState === "saving" ? "保存中…"
    : saveState === "dirty" ? "编辑中…"
    : saveState === "error" ? "保存失败，稍后自动重试"
    : savedAt ? `已保存 ${relativeTime(savedAt)}` : "";

  return (
    <div className="writing-studio">
      <button className="writing-list-toggle button secondary" type="button" onClick={() => setListOpen((v) => !v)}>
        文档（{docs.length}）
      </button>

      <aside className={`writing-sidebar${listOpen ? " open" : ""}`}>
        <div className="writing-sidebar-head">
          <strong>我的文档</strong>
          <button className="text-link" type="button" onClick={() => void createDoc()}>+ 新建</button>
        </div>
        <ul className="writing-doc-list">
          {docs.map((doc) => (
            <li key={doc.id} className={doc.id === active.id ? "active" : ""}>
              <button className="writing-doc-item" type="button" onClick={() => void openDoc(doc.id)}>
                <span className="writing-doc-title">{doc.title || "无标题"}</span>
                <span className="writing-doc-time">{relativeTime(doc.updatedAt)}</span>
              </button>
              <button className="writing-doc-delete" type="button" aria-label="删除文档" title="删除" onClick={() => void deleteDoc(doc.id)}>×</button>
            </li>
          ))}
        </ul>

        <details className="writing-model">
          <summary>AI 模型设置</summary>
          <p className="muted">默认使用站点模型；填入自己的服务后本页 AI 走你的模型。</p>
          <label>服务商
            <select value={provider} onChange={(event) => applyProviderPreset(event.target.value)}>
              {MODEL_PROVIDER_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>{preset.label}</option>
              ))}
            </select>
          </label>
          <label>Base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" />
          </label>
          <label>模型名
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="model-name" />
          </label>
          <label>API Key（仅本次会话，不保存）
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
          </label>
        </details>
      </aside>

      <div className="writing-canvas">
        <div className="writing-meta-row">
          <span className={`writing-save-state state-${saveState}`}>{saveLabel}</span>
          <span className="writing-word-count">{wordCount} 字</span>
          <a
            className="text-link"
            href={`data:text/markdown;charset=utf-8,${encodeURIComponent(`# ${active.title || "无标题"}\n\n${active.content}`)}`}
            download={`${(active.title || "无标题").slice(0, 60)}.md`}
          >
            导出 Markdown
          </a>
        </div>

        <textarea
          ref={titleRef}
          className="writing-title"
          placeholder="无标题"
          rows={1}
          maxLength={300}
          value={active.title}
          onChange={(event) => {
            const title = event.target.value.replace(/\n/g, "");
            setActive((current) => current ? { ...current, title } : current);
            scheduleSave(title, active.content);
            event.target.style.height = "auto";
            event.target.style.height = `${event.target.scrollHeight}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "ArrowDown") {
              event.preventDefault();
              editorRef.current?.commands.focus("start");
            }
          }}
        />

        <NotionEditor
          docId={active.id}
          initialMarkdown={active.content}
          onReady={(editor) => { editorRef.current = editor; }}
          onMarkdownChange={(markdown) => {
            setActive((current) => current ? { ...current, content: markdown } : current);
            scheduleSave(active.title, markdown);
          }}
          onAiSelection={onAiSelection}
          onAiContinue={onAiContinue}
        />

        {ai ? (
          <div className={`ai-review-card status-${ai.status}`} role="dialog" aria-label="AI 结果">
            <div className="ai-review-head">
              <strong>AI {ai.label}</strong>
              {ai.status === "loading" ? <span className="muted">思考中…</span> : null}
              <button className="text-link" type="button" onClick={() => setAi(null)}>关闭</button>
            </div>
            {ai.status === "error" ? <p className="form-error">{ai.error}</p> : null}
            {ai.status === "done" ? (
              <>
                {/* markdownToHtml 内部走 DOMPurify,富文本预览与插入结果一致 */}
                <div
                  className="ai-review-output prose"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(ai.output) }}
                />
                <div className="ai-review-actions">
                  {ai.mode === "selection" ? (
                    <button className="button" type="button" onClick={() => insertAiOutput("replace")}>替换选区</button>
                  ) : null}
                  <button className="button secondary" type="button" onClick={() => insertAiOutput("below")}>
                    {ai.mode === "selection" ? "插入下方" : "插入文末"}
                  </button>
                  <button className="button secondary" type="button" onClick={() => void runAi(ai)}>重试</button>
                  <button className="text-link" type="button" onClick={() => setAi(null)}>舍弃</button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
