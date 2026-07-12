"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { MODEL_PROVIDER_PRESETS } from "@/lib/model-providers";
import { markdownToHtml } from "@/lib/markdown";
import { createDocumentSaveCoordinator, isAiSelectionCurrent } from "@/lib/writing-client-state";
import { NotionEditor, type AiSelectionKind, type AiSelectionRequest } from "./NotionEditor";

type DocMeta = { id: string; title: string; updatedAt: string };
type DocFull = DocMeta & { content: string };

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

type AiTask = {
  requestId: number;
  mode: "selection" | "continue";
  kind: AiSelectionKind | "continue";
  label: string;
  source: string;
  docId: string;
  revision: number;
  from: number;
  to: number;
  status: "loading" | "done" | "error";
  output: string;
  error: string;
};

const LEGACY_DRAFT_KEY = "shibei-write-draft-v1";
const MODEL_KEY = "shibei-write-model-v2";
const SAVE_RETRY_MS = 5_000;

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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string>("");
  const contentRevisionRef = useRef(0);
  const documentRequestRef = useRef(0);
  const documentActionRef = useRef(false);
  const aiRequestRef = useRef(0);
  const aiAbortRef = useRef<AbortController | null>(null);
  const saveCoordinatorRef = useRef<ReturnType<typeof createDocumentSaveCoordinator<{ title: string; content: string }>> | null>(null);
  if (!saveCoordinatorRef.current) {
    saveCoordinatorRef.current = createDocumentSaveCoordinator(async (id, pending) => {
      const { doc } = await requestJson<{ doc: DocMeta }>(`/api/public/writing/docs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending)
      });
      if (activeIdRef.current === id) setSavedAt(doc.updatedAt);
      setDocs((current) => {
        const updated = current.map((item) =>
          item.id === id ? { ...item, title: pending.title, updatedAt: doc.updatedAt } : item
        );
        const target = updated.find((item) => item.id === id);
        return target ? [target, ...updated.filter((item) => item.id !== id)] : updated;
      });
    });
  }

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

  const flushSave = useCallback(async (docId?: string): Promise<boolean> => {
    const id = docId || activeIdRef.current;
    if (!id || !saveCoordinatorRef.current?.peek(id)) return true;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (activeIdRef.current === id) setSaveState("saving");
    try {
      await saveCoordinatorRef.current.flush(id);
      if (activeIdRef.current === id) setSaveState("saved");
      return true;
    } catch {
      if (activeIdRef.current === id) {
        setSaveState("error");
        // Keep retrying the newest coalesced value. The coordinator retains it
        // after failures, so transient network errors no longer require another
        // keystroke and the timer callback cannot create an unhandled rejection.
        if (saveCoordinatorRef.current?.peek(id)) {
          saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            void flushSave(id);
          }, SAVE_RETRY_MS);
        }
      }
      return false;
    }
  }, []);

  const scheduleSave = useCallback((title: string, content: string) => {
    const id = activeIdRef.current;
    if (!id) return;
    saveCoordinatorRef.current?.enqueue(id, { title, content });
    setSaveState("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave(id);
    }, 1200);
  }, [flushSave]);

  const openDoc = useCallback(async (id: string, list?: DocMeta[]) => {
    if (id === activeIdRef.current) {
      setListOpen(false);
      return;
    }
    const requestId = ++documentRequestRef.current;
    const previousId = activeIdRef.current;
    setFatal("");
    if (!(await flushSave(previousId)) || requestId !== documentRequestRef.current) return;
    try {
      const { doc } = await requestJson<{ doc: DocFull }>(`/api/public/writing/docs/${id}`);
      if (requestId !== documentRequestRef.current) return;
      // Edits can still arrive while the target document is loading. Drain the
      // previous document once more immediately before committing the switch.
      if (!(await flushSave(previousId)) || requestId !== documentRequestRef.current) return;
      setActive(doc);
      activeIdRef.current = doc.id;
      contentRevisionRef.current = 0;
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
    if (documentActionRef.current) return;
    documentActionRef.current = true;
    const requestId = ++documentRequestRef.current;
    const previousId = activeIdRef.current;
    setFatal("");
    try {
      if (!(await flushSave(previousId)) || requestId !== documentRequestRef.current) return;
      const { doc } = await requestJson<{ doc: DocFull }>("/api/public/writing/docs", { method: "POST" });
      setDocs((current) => [{ id: doc.id, title: doc.title, updatedAt: doc.updatedAt }, ...current]);
      // The POST may finish after the user selected another document. Keep the
      // created document in the list, but do not steal focus from the newer action.
      if (requestId !== documentRequestRef.current) return;
      setActive(doc);
      activeIdRef.current = doc.id;
      contentRevisionRef.current = 0;
      setSaveState("idle");
      setSavedAt(doc.updatedAt);
      setAi(null);
      setTimeout(() => titleRef.current?.focus(), 50);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      documentActionRef.current = false;
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
        saveCoordinatorRef.current?.clear(id);
        if (rest.length) await openDoc(rest[0].id);
        else await createDoc();
      }
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    }
  }, [docs, openDoc, createDoc]);

  // 卸载前尽力保存
  useEffect(() => {
    const persistPending = () => {
      const id = activeIdRef.current;
      const pending = saveCoordinatorRef.current?.peek(id)?.value;
      if (!id || !pending) return;
      const body = JSON.stringify(pending);
      let queued = false;
      try {
        const blob = new Blob([body], { type: "application/json" });
        // Browsers commonly cap the entire keepalive/beacon queue near 64 KiB.
        // Do not pretend a large draft was queued when it was guaranteed to fail.
        if (blob.size <= 60_000) {
          queued = navigator.sendBeacon?.(`/api/public/writing/docs/${id}`, blob) ?? false;
        }
      } catch { /* ignore */ }
      if (!queued && body.length <= 60_000) {
        void fetch(`/api/public/writing/docs/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true
        }).catch(() => undefined);
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const id = activeIdRef.current;
      if (!id || !saveCoordinatorRef.current?.peek(id)) return;
      persistPending();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", persistPending);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", persistPending);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Next.js client-side navigation unmounts the studio without firing
      // pagehide. Keep the normal PATCH alive as well as the beacon fallback.
      persistPending();
      const id = activeIdRef.current;
      if (id) void saveCoordinatorRef.current?.flush(id).catch(() => undefined);
      aiAbortRef.current?.abort();
    };
  }, []);

  // —— AI ——
  const customModel = useMemo(
    () => apiKey.trim() && baseUrl.trim() && model.trim()
      ? { baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() }
      : null,
    [apiKey, baseUrl, model]
  );

  const runAi = useCallback(async (task: Omit<AiTask, "requestId" | "status" | "output" | "error">) => {
    const requestId = ++aiRequestRef.current;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAi({ ...task, requestId, status: "loading", output: "", error: "" });
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
        body: JSON.stringify({ title: active?.title || "", draft, instruction, language: "zh", customModel }),
        signal: controller.signal
      });
      setAi((current) => current?.requestId === requestId
        ? { ...current, status: "done", output: output.trim() }
        : current);
    } catch (err) {
      if (controller.signal.aborted) return;
      setAi((current) => current?.requestId === requestId
        ? { ...current, status: "error", error: err instanceof Error ? err.message : String(err) }
        : current);
    } finally {
      if (aiRequestRef.current === requestId) aiAbortRef.current = null;
    }
  }, [active?.title, active?.content, customModel]);

  const onAiSelection = useCallback((request: AiSelectionRequest) => {
    void runAi({
      mode: "selection",
      kind: request.kind,
      label: AI_INSTRUCTIONS[request.kind].label,
      source: request.text,
      docId: activeIdRef.current,
      revision: contentRevisionRef.current,
      from: request.from,
      to: request.to
    });
  }, [runAi]);

  const onAiContinue = useCallback(() => {
    void runAi({ mode: "continue", kind: "continue", label: "续写", source: "", docId: activeIdRef.current, revision: contentRevisionRef.current, from: 0, to: 0 });
  }, [runAi]);

  const aiSelectionIsCurrent = Boolean(
    ai
    && ai.mode === "selection"
    && active
    && editorRef.current
    && ai.from >= 0
    && ai.to >= ai.from
    && ai.to <= editorRef.current.state.doc.content.size
    && isAiSelectionCurrent(
      { docId: ai.docId, revision: ai.revision, source: ai.source },
      {
        docId: active.id,
        revision: contentRevisionRef.current,
        selectedText: editorRef.current.state.doc.textBetween(ai.from, ai.to, "\n")
      }
    )
  );
  const aiContinuationIsCurrent = Boolean(
    ai
    && ai.mode === "continue"
    && active
    && ai.docId === active.id
    && ai.revision === contentRevisionRef.current
  );

  const insertAiOutput = (strategy: "replace" | "below" | "end") => {
    const editor = editorRef.current;
    if (!editor || !ai || ai.status !== "done" || !ai.output) return;
    // tiptap-markdown 接管了 insertContent 的字符串解析:直接喂 markdown,
    // 粗体/列表/标题等按富文本落进文档(与全站存储格式一致)。
    const markdown = ai.output;
    if (ai.mode === "continue" && !aiContinuationIsCurrent) return;
    if (ai.mode === "selection" && !aiSelectionIsCurrent && strategy !== "end") return;
    if (ai.mode === "selection" && strategy === "replace") {
      editor.chain().focus().deleteRange({ from: ai.from, to: ai.to }).insertContentAt(ai.from, markdown).run();
    } else if (ai.mode === "selection" && strategy === "below") {
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
      {fatal ? <p className="form-error" role="alert">{fatal}</p> : null}
      <button
        className="writing-list-toggle button secondary"
        type="button"
        aria-expanded={listOpen}
        aria-controls="writing-document-sidebar"
        onClick={() => setListOpen((v) => !v)}
      >
        文档（{docs.length}）
      </button>

      <aside id="writing-document-sidebar" className={`writing-sidebar${listOpen ? " open" : ""}`} aria-label="文档与模型设置">
        <div className="writing-sidebar-head">
          <strong>我的文档</strong>
          <button className="text-link" type="button" onClick={() => void createDoc()}>+ 新建</button>
        </div>
        <ul className="writing-doc-list">
          {docs.map((doc) => (
            <li key={doc.id} className={doc.id === active.id ? "active" : ""}>
              <button
                className="writing-doc-item"
                type="button"
                aria-current={doc.id === active.id ? "true" : undefined}
                onClick={() => void openDoc(doc.id)}
              >
                <span className="writing-doc-title">{doc.title || "无标题"}</span>
                <span className="writing-doc-time">{relativeTime(doc.updatedAt)}</span>
              </button>
              <button className="writing-doc-delete" type="button" aria-label={`删除文档：${doc.title || "无标题"}`} title="删除" onClick={() => void deleteDoc(doc.id)}>×</button>
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
          <span className={`writing-save-state state-${saveState}`} role="status" aria-live="polite">{saveLabel}</span>
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
          aria-label="文稿标题"
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
            contentRevisionRef.current += 1;
            setActive((current) => current ? { ...current, content: markdown } : current);
            scheduleSave(active.title, markdown);
          }}
          onAiSelection={onAiSelection}
          onAiContinue={onAiContinue}
        />

        {ai ? (
          <div className={`ai-review-card status-${ai.status}`} role="region" aria-label="AI 结果">
            <div className="ai-review-head">
              <strong>AI {ai.label}</strong>
              {ai.status === "loading" ? <span className="muted">思考中…</span> : null}
              <button className="text-link" type="button" onClick={() => setAi(null)}>关闭</button>
            </div>
            {ai.status === "error" ? <p className="form-error">{ai.error}</p> : null}
            {ai.status === "done" ? (
              <>
                <p className="sr-only" role="status">AI {ai.label}内容已生成</p>
                {/* markdownToHtml 内部走 DOMPurify,富文本预览与插入结果一致 */}
                <div
                  className="ai-review-output prose"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(ai.output) }}
                />
                <div className="ai-review-actions">
                  {ai.mode === "selection" && aiSelectionIsCurrent ? (
                    <button className="button" type="button" onClick={() => insertAiOutput("replace")}>替换选区</button>
                  ) : null}
                  {ai.mode === "selection" && !aiSelectionIsCurrent ? (
                    <>
                      <p className="form-error" role="alert">原选区已变化，为避免覆盖错误内容，只能安全插入文末。</p>
                      <button className="button secondary" type="button" onClick={() => insertAiOutput("end")}>插入文末</button>
                    </>
                  ) : ai.mode === "continue" && !aiContinuationIsCurrent ? (
                    <p className="form-error" role="alert">正文已变化，这份续写基于旧稿生成，请重新生成后再插入。</p>
                  ) : (
                    <button className="button secondary" type="button" onClick={() => insertAiOutput("below")}>
                      {ai.mode === "selection" ? "插入下方" : "插入文末"}
                    </button>
                  )}
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
