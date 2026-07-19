"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  ANON_CREATION_SEED_HEADER,
  ensureAnonymousBootstrap
} from "@/lib/client/anon-bootstrap";
import { MODEL_PROVIDER_PRESETS } from "@/lib/model-providers";
import { markdownToHtml } from "@/lib/markdown";
import {
  createDocumentRecoverySnapshot,
  createDocumentSaveCoordinator,
  isAiSelectionCurrent,
  isWritingRevisionConflict,
  parseDocumentRecoverySnapshot,
  reconcileDocumentRecoveryAfterSave,
  resolveDocumentRecovery,
  type DocumentRecoverySnapshot,
  type WritingDocumentValue
} from "@/lib/writing-client-state";
import { TaskProgress } from "@/components/TaskProgress";
import { MAX_SCORABLE_WORK_CONTENT_LENGTH } from "@/lib/creation-limits";
import { NotionEditor, type AiSelectionKind, type AiSelectionRequest } from "./NotionEditor";

type DocMeta = {
  id: string;
  title: string;
  completedAt: string | null;
  creativeWorkId: string | null;
  publicationBlockedAt: string | null;
  updatedAt: string;
};
type DocFull = DocMeta & { content: string };
type DocListPage = { docs: DocMeta[]; nextCursor: string | null; hasMore: boolean };

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type WritingMode = "manual" | "assist";
type WritingView = "edit" | "preview";
type ManualGenre = { id: string; name: string; description: string; threshold: number };
type ManualDepth = "SHORT" | "FULL";
type ManualDepthMeta = { label: string; description: string };

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
const RECOVERY_KEY_PREFIX = "shibei-write-recovery-v1:";
const SAVE_RETRY_MS = 5_000;

function liveEditor(editor: Editor | null | undefined): Editor | null {
  return editor && !editor.isDestroyed ? editor : null;
}

function recoveryKey(docId: string) {
  return `${RECOVERY_KEY_PREFIX}${docId}`;
}

function readRecoverySnapshot(docId: string) {
  try {
    const snapshot = parseDocumentRecoverySnapshot(window.localStorage.getItem(recoveryKey(docId)));
    if (snapshot?.docId === docId) return snapshot;
    window.localStorage.removeItem(recoveryKey(docId));
  } catch { /* localStorage can be unavailable in private/restricted contexts */ }
  return null;
}

function persistRecoverySnapshot(
  docId: string,
  value: WritingDocumentValue,
  serverUpdatedAt: string,
  editorSessionId: string
) {
  if (!serverUpdatedAt) return;
  try {
    window.localStorage.setItem(
      recoveryKey(docId),
      JSON.stringify(createDocumentRecoverySnapshot({ docId, value, serverUpdatedAt, editorSessionId }))
    );
  } catch { /* remote autosave remains the primary persistence path */ }
}

function clearRecoverySnapshot(docId: string) {
  try { window.localStorage.removeItem(recoveryKey(docId)); } catch { /* ignore */ }
}

function reconcileRecoverySnapshotAfterSave(
  docId: string,
  value: WritingDocumentValue,
  serverUpdatedAt: string,
  editorSessionId: string
) {
  const snapshot = readRecoverySnapshot(docId);
  const next = reconcileDocumentRecoveryAfterSave({
    snapshot,
    docId,
    editorSessionId,
    savedValue: value,
    serverUpdatedAt
  });
  if (!next) clearRecoverySnapshot(docId);
  else if (next !== snapshot) {
    try { window.localStorage.setItem(recoveryKey(docId), JSON.stringify(next)); } catch { /* ignore */ }
  }
}

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
    instruction: "把【当前文稿】中的文字扩写得更充实：只能展开原稿已有的信息、感受和逻辑，不得新增原稿没有的事实、数字、引语、事例或来源。缺少必要信息时用【待补充：……】标记，不要猜。保持原语言与风格，只输出扩写后的文本。"
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
  if (!response.ok) {
    throw new HttpRequestError(
      (data as { error?: string }).error || `请求失败（${response.status}）`,
      response.status
    );
  }
  return data as T;
}

class HttpRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HttpRequestError";
  }
}

export function WritingStudio() {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [docsNextCursor, setDocsNextCursor] = useState<string | null>(null);
  const [docsLoadingMore, setDocsLoadingMore] = useState(false);
  const [active, setActive] = useState<DocFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string>("");
  const [fatal, setFatal] = useState("");
  const [ai, setAi] = useState<AiTask | null>(null);
  // 纯手写是默认且真实隔离的模式：不展示 AI 操作，也不会发起模型请求。
  const [writingMode, setWritingMode] = useState<WritingMode>("manual");
  const [writingView, setWritingView] = useState<WritingView>("edit");
  const [completionBusy, setCompletionBusy] = useState<"complete" | "options" | "handoff" | null>(null);
  const [completionError, setCompletionError] = useState("");
  const [recoveryConflict, setRecoveryConflict] = useState<DocumentRecoverySnapshot | null>(null);
  const [recoveryActionBusy, setRecoveryActionBusy] = useState(false);
  const [documentTransitionBusy, setDocumentTransitionBusy] = useState(false);
  const [documentActionBusy, setDocumentActionBusy] = useState(false);
  const [manualGenres, setManualGenres] = useState<ManualGenre[]>([]);
  const [manualDepths, setManualDepths] = useState<Record<ManualDepth, ManualDepthMeta> | null>(null);
  const [manualGenreId, setManualGenreId] = useState("");
  const [manualDepth, setManualDepth] = useState<ManualDepth>("SHORT");

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
  const documentTransitionRef = useRef(false);
  const recoveryActionRef = useRef(false);
  const docsPageLoadingRef = useRef(false);
  const revisionConflictDocRef = useRef("");
  const conflictLocalValueRef = useRef(new Map<string, WritingDocumentValue>());
  const conflictBaseUpdatedAtRef = useRef(new Map<string, string>());
  const conflictServerDocRef = useRef(new Map<string, DocFull>());
  const aiRequestRef = useRef(0);
  const aiAbortRef = useRef<AbortController | null>(null);
  const editorSessionIdRef = useRef("");
  if (!editorSessionIdRef.current) {
    editorSessionIdRef.current = globalThis.crypto?.randomUUID?.()
      || `editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  const serverUpdatedAtRef = useRef(new Map<string, string>());
  const latestDocumentValueRef = useRef(new Map<string, WritingDocumentValue>());
  const saveCoordinatorRef = useRef<ReturnType<typeof createDocumentSaveCoordinator<{ title: string; content: string }>> | null>(null);
  if (!saveCoordinatorRef.current) {
    saveCoordinatorRef.current = createDocumentSaveCoordinator(async (id, pending) => {
      const expectedUpdatedAt = serverUpdatedAtRef.current.get(id);
      if (!expectedUpdatedAt) throw new Error("缺少文档版本，请重新打开后再保存");
      const { doc } = await requestJson<{ doc: DocMeta }>(`/api/public/writing/docs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pending, expectedUpdatedAt })
      });
      serverUpdatedAtRef.current.set(id, doc.updatedAt);
      // A request for an older queued value may finish while a newer local edit
      // already exists. Only remove the fallback if it still represents the
      // exact title/content that this successful PATCH made durable.
      reconcileRecoverySnapshotAfterSave(
        id,
        pending,
        doc.updatedAt,
        editorSessionIdRef.current
      );
      if (activeIdRef.current === id) {
        setSavedAt(doc.updatedAt);
        setActive((current) => current ? {
          ...current,
          completedAt: doc.completedAt,
          creativeWorkId: doc.creativeWorkId,
          publicationBlockedAt: doc.publicationBlockedAt,
          updatedAt: doc.updatedAt
        } : current);
      }
      setDocs((current) => {
        const updated = current.map((item) =>
          item.id === id ? { ...item, ...doc, title: pending.title } : item
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

  const loadMoreDocs = useCallback(async () => {
    const cursor = docsNextCursor;
    if (!cursor || docsPageLoadingRef.current) return;
    docsPageLoadingRef.current = true;
    setDocsLoadingMore(true);
    setFatal("");
    try {
      const page = await requestJson<DocListPage>(
        `/api/public/writing/docs?cursor=${encodeURIComponent(cursor)}`
      );
      setDocs((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...page.docs.filter((item) => !existing.has(item.id))];
      });
      setDocsNextCursor(page.nextCursor);
    } catch (error) {
      setFatal(error instanceof Error ? error.message : String(error));
    } finally {
      docsPageLoadingRef.current = false;
      setDocsLoadingMore(false);
    }
  }, [docsNextCursor]);

  // —— 初始化:拉列表;空则迁移旧草稿或新建 ——
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 严格初始化屏障：列表 GET 与“空列表自动新建”都不得抢在匿名 cookie 前。
        const anonymousSeed = await ensureAnonymousBootstrap();
        const { docs: list, nextCursor } = await requestJson<DocListPage>("/api/public/writing/docs");
        if (cancelled) return;
        setDocsNextCursor(nextCursor);
        if (list.length) {
          setDocs(list);
          await openDoc(list[0].id, list);
        } else {
          let legacy: { title?: string; draft?: string } | null = null;
          try {
            const raw = window.localStorage.getItem(LEGACY_DRAFT_KEY);
            if (raw) legacy = JSON.parse(raw) as { title?: string; draft?: string };
          } catch { /* ignore */ }
          const created = await requestJson<{ doc: DocFull }>("/api/public/writing/docs", {
            method: "POST",
            headers: { [ANON_CREATION_SEED_HEADER]: anonymousSeed }
          });
          if (legacy && (legacy.title || legacy.draft)) {
            const { doc: migrated } = await requestJson<{ doc: DocMeta }>(`/api/public/writing/docs/${created.doc.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: legacy.title || "",
                content: legacy.draft || "",
                expectedUpdatedAt: created.doc.updatedAt
              })
            });
            created.doc.title = legacy.title || "";
            created.doc.content = legacy.draft || "";
            created.doc.updatedAt = migrated.updatedAt;
            try { window.localStorage.removeItem(LEGACY_DRAFT_KEY); } catch { /* ignore */ }
          }
          if (cancelled) return;
          setDocs([{
            id: created.doc.id,
            title: created.doc.title,
            completedAt: created.doc.completedAt,
            creativeWorkId: created.doc.creativeWorkId,
            publicationBlockedAt: created.doc.publicationBlockedAt,
            updatedAt: created.doc.updatedAt
          }]);
          setActive(created.doc);
          activeIdRef.current = created.doc.id;
          latestDocumentValueRef.current.set(created.doc.id, {
            title: created.doc.title,
            content: created.doc.content
          });
          serverUpdatedAtRef.current.set(created.doc.id, created.doc.updatedAt);
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
    if (!id) return true;
    if (revisionConflictDocRef.current === id) return false;
    if (!saveCoordinatorRef.current?.peek(id)) return true;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (activeIdRef.current === id) setSaveState("saving");
    try {
      await saveCoordinatorRef.current.flush(id);
      if (activeIdRef.current === id) setSaveState("saved");
      return true;
    } catch (error) {
      if (isWritingRevisionConflict(error)) {
        // A stale AI card is just as dangerous as a stale save: Tiptap commands
        // can still mutate a non-editable editor programmatically. Invalidate
        // every in-flight/result card before exposing either recovery version.
        aiAbortRef.current?.abort();
        aiAbortRef.current = null;
        aiRequestRef.current += 1;
        setAi(null);
        // Lock synchronously, before React has a chance to render the recovery
        // panel. `contenteditable=false` alone is insufficient unless it is
        // applied before an already-open slash/bubble command can run.
        revisionConflictDocRef.current = id;
        if (activeIdRef.current === id) {
          const editor = liveEditor(editorRef.current);
          editor?.setEditable(false, false);
          editor?.commands.blur();
        }
        const localValue = saveCoordinatorRef.current?.peek(id)?.value;
        const baseUpdatedAt = serverUpdatedAtRef.current.get(id) || "";
        if (localValue) {
          conflictLocalValueRef.current.set(id, localValue);
          conflictBaseUpdatedAtRef.current.set(id, baseUpdatedAt);
          persistRecoverySnapshot(
            id,
            localValue,
            baseUpdatedAt,
            editorSessionIdRef.current
          );
        }
        // The coordinator requeues failed values. A revision conflict is not a
        // transient network failure: remove it immediately so the old CAS token
        // can never be retried every five seconds.
        saveCoordinatorRef.current?.clear(id);
        const newestLocal = conflictLocalValueRef.current.get(id) || localValue;
        const snapshot = readRecoverySnapshot(id) || (newestLocal
          ? createDocumentRecoverySnapshot({
              docId: id,
              value: newestLocal,
              editorSessionId: editorSessionIdRef.current,
              serverUpdatedAt: conflictBaseUpdatedAtRef.current.get(id) || baseUpdatedAt
            })
          : null);
        if (activeIdRef.current === id) {
          setSaveState("conflict");
          if (snapshot) setRecoveryConflict(snapshot);
        }

        try {
          const { doc: serverDoc } = await requestJson<{ doc: DocFull }>(
            `/api/public/writing/docs/${id}`
          );
          serverUpdatedAtRef.current.set(id, serverDoc.updatedAt);
          conflictServerDocRef.current.set(id, serverDoc);
          if (activeIdRef.current === id) {
            setActive(serverDoc);
            setDocs((items) => items.map((item) => item.id === id ? {
              id: serverDoc.id,
              title: serverDoc.title,
              completedAt: serverDoc.completedAt,
              creativeWorkId: serverDoc.creativeWorkId,
              publicationBlockedAt: serverDoc.publicationBlockedAt,
              updatedAt: serverDoc.updatedAt
            } : item));
            setSavedAt(serverDoc.updatedAt);
            setWritingView("edit");
            setCompletionError("");
            liveEditor(editorRef.current)?.commands.setContent(serverDoc.content, { emitUpdate: false });
            contentRevisionRef.current += 1;
          }
        } catch (reloadError) {
          if (activeIdRef.current === id) {
            setFatal(
              reloadError instanceof Error
                ? `检测到版本冲突，但读取服务器版失败：${reloadError.message}。本地稿仍已保留，可直接选择恢复后重试。`
                : "检测到版本冲突，但暂时无法读取服务器版。本地稿仍已保留，可直接选择恢复后重试。"
            );
          }
        }
        return false;
      }
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

  const scheduleSave = useCallback((id: string, title: string, content: string, allowDuringTransition = false) => {
    // The event identifies the document actually rendered in its editor. Never
    // infer the target from a ref that a concurrent switch may have advanced.
    if (!id || id !== activeIdRef.current) return;
    if (documentTransitionRef.current && !allowDuringTransition) return;
    const value = { title, content };
    latestDocumentValueRef.current.set(id, value);
    if (revisionConflictDocRef.current === id) {
      const existing = readRecoverySnapshot(id);
      const baseUpdatedAt = conflictBaseUpdatedAtRef.current.get(id)
        || existing?.serverUpdatedAt
        || serverUpdatedAtRef.current.get(id)
        || "";
      conflictLocalValueRef.current.set(id, value);
      conflictBaseUpdatedAtRef.current.set(id, baseUpdatedAt);
      persistRecoverySnapshot(id, value, baseUpdatedAt, editorSessionIdRef.current);
      setSaveState("conflict");
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      return;
    }
    saveCoordinatorRef.current?.enqueue(id, value);
    // localStorage is synchronous and accepts drafts above the keepalive/beacon
    // ceiling, so even an immediate close after a >60-KiB edit remains recoverable.
    persistRecoverySnapshot(
      id,
      value,
      serverUpdatedAtRef.current.get(id) || "",
      editorSessionIdRef.current
    );
    setSaveState("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave(id);
    }, 1200);
  }, [flushSave]);

  const restoreConflictingRecovery = useCallback(async () => {
    const current = active;
    const fallback = recoveryConflict;
    if (!fallback || !current || recoveryActionRef.current) return;
    const stored = readRecoverySnapshot(current.id);
    const localValue = conflictLocalValueRef.current.get(current.id) || stored || fallback;
    const snapshot: DocumentRecoverySnapshot = {
      ...(stored || fallback),
      title: localValue.title,
      content: localValue.content
    };
    recoveryActionRef.current = true;
    setRecoveryActionBusy(true);
    setFatal("");
    try {
      let serverDoc = conflictServerDocRef.current.get(current.id);
      if (!serverDoc) {
        const loaded = await requestJson<{ doc: DocFull }>(`/api/public/writing/docs/${current.id}`);
        serverDoc = loaded.doc;
        conflictServerDocRef.current.set(current.id, serverDoc);
        serverUpdatedAtRef.current.set(current.id, serverDoc.updatedAt);
      }
      if (serverDoc.creativeWorkId) {
        // A handed-off WritingDoc is immutable. Preserve the user's local value
        // by restoring it into a new private document instead of mutating the
        // source snapshot behind the CreativeWork.
        const { doc: created } = await requestJson<{ doc: DocFull }>(
          "/api/public/writing/docs",
          { method: "POST" }
        );
        const { doc: saved } = await requestJson<{ doc: DocMeta }>(
          `/api/public/writing/docs/${created.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: snapshot.title,
              content: snapshot.content,
              expectedUpdatedAt: created.updatedAt
            })
          }
        );
        const restored: DocFull = {
          ...created,
          ...saved,
          title: snapshot.title,
          content: snapshot.content,
          completedAt: null,
          creativeWorkId: null
        };
        clearRecoverySnapshot(current.id);
        revisionConflictDocRef.current = "";
        conflictLocalValueRef.current.delete(current.id);
        conflictBaseUpdatedAtRef.current.delete(current.id);
        conflictServerDocRef.current.delete(current.id);
        serverUpdatedAtRef.current.set(restored.id, restored.updatedAt);
        activeIdRef.current = restored.id;
        latestDocumentValueRef.current.set(restored.id, {
          title: restored.title,
          content: restored.content
        });
        setDocs((items) => [restored, ...items]);
        setActive(restored);
        setSavedAt(restored.updatedAt);
        setSaveState("saved");
        setWritingView("edit");
        setRecoveryConflict(null);
        return;
      }

      setActive({
        ...serverDoc,
        title: snapshot.title,
        content: snapshot.content,
        completedAt: null
      });
      setDocs((items) => items.map((item) => item.id === current.id
        ? {
            id: serverDoc.id,
            title: snapshot.title,
            completedAt: null,
            creativeWorkId: serverDoc.creativeWorkId,
            publicationBlockedAt: serverDoc.publicationBlockedAt,
            updatedAt: serverDoc.updatedAt
          }
        : item));
      liveEditor(editorRef.current)?.commands.setContent(snapshot.content, { emitUpdate: false });
      contentRevisionRef.current += 1;
      revisionConflictDocRef.current = "";
      conflictLocalValueRef.current.delete(current.id);
      conflictBaseUpdatedAtRef.current.delete(current.id);
      conflictServerDocRef.current.delete(current.id);
      setRecoveryConflict(null);
      scheduleSave(current.id, snapshot.title, snapshot.content);
    } catch (error) {
      setFatal(error instanceof Error ? error.message : String(error));
    } finally {
      recoveryActionRef.current = false;
      setRecoveryActionBusy(false);
    }
  }, [active, recoveryConflict, scheduleSave]);

  const keepServerRecoveryVersion = useCallback(async () => {
    const id = recoveryConflict?.docId;
    if (!id || recoveryActionRef.current) return;
    recoveryActionRef.current = true;
    setRecoveryActionBusy(true);
    setFatal("");
    try {
      let serverDoc = conflictServerDocRef.current.get(id);
      if (!serverDoc) {
        const loaded = await requestJson<{ doc: DocFull }>(`/api/public/writing/docs/${id}`);
        serverDoc = loaded.doc;
      }
      serverUpdatedAtRef.current.set(id, serverDoc.updatedAt);
      conflictServerDocRef.current.set(id, serverDoc);
      if (activeIdRef.current === id) {
        latestDocumentValueRef.current.set(id, {
          title: serverDoc.title,
          content: serverDoc.content
        });
        setActive(serverDoc);
        setDocs((items) => items.map((item) => item.id === id ? {
          id: serverDoc.id,
          title: serverDoc.title,
          completedAt: serverDoc.completedAt,
          creativeWorkId: serverDoc.creativeWorkId,
          publicationBlockedAt: serverDoc.publicationBlockedAt,
          updatedAt: serverDoc.updatedAt
        } : item));
        liveEditor(editorRef.current)?.commands.setContent(serverDoc.content, { emitUpdate: false });
        contentRevisionRef.current += 1;
        setSavedAt(serverDoc.updatedAt);
      }
      clearRecoverySnapshot(id);
      saveCoordinatorRef.current?.clear(id);
      conflictLocalValueRef.current.delete(id);
      conflictBaseUpdatedAtRef.current.delete(id);
      conflictServerDocRef.current.delete(id);
      if (revisionConflictDocRef.current === id) revisionConflictDocRef.current = "";
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setSaveState("saved");
      setRecoveryConflict(null);
    } catch (error) {
      setFatal(error instanceof Error ? error.message : String(error));
    } finally {
      recoveryActionRef.current = false;
      setRecoveryActionBusy(false);
    }
  }, [recoveryConflict]);

  const beginDocumentTransition = useCallback(() => {
    documentTransitionRef.current = true;
    setDocumentTransitionBusy(true);
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    aiRequestRef.current += 1;
    setAi(null);
    // Preview mode unmounts and destroys Tiptap while retaining the last ref
    // until a future editor mounts. Calling commands on that destroyed instance
    // throws synchronously and used to make “继续到评分与发布” a silent no-op.
    const editor = liveEditor(editorRef.current);
    if (editor) {
      editor.setEditable(false, false);
      editor.commands.blur();
    }
    if (titleRef.current) titleRef.current.readOnly = true;
  }, []);

  const finishDocumentTransition = useCallback((requestId: number) => {
    // An older request must never unlock the editor while a newer switch is
    // still fetching or committing its target document.
    if (requestId !== documentRequestRef.current) return;
    documentTransitionRef.current = false;
    setDocumentTransitionBusy(false);
  }, []);

  const openDoc = useCallback(async (id: string, list?: DocMeta[]) => {
    if (documentActionRef.current) return;
    if (id === activeIdRef.current) {
      setListOpen(false);
      return;
    }
    const requestId = ++documentRequestRef.current;
    const previousId = activeIdRef.current;
    setFatal("");
    beginDocumentTransition();
    try {
      if (!(await flushSave(previousId)) || requestId !== documentRequestRef.current) return;
      const { doc } = await requestJson<{ doc: DocFull }>(`/api/public/writing/docs/${id}`);
      if (requestId !== documentRequestRef.current) return;
      // Edits can still arrive while the target document is loading. Drain the
      // previous document once more immediately before committing the switch.
      if (!(await flushSave(previousId)) || requestId !== documentRequestRef.current) return;
      serverUpdatedAtRef.current.set(doc.id, doc.updatedAt);
      const recovery = readRecoverySnapshot(doc.id);
      const recoveryResolution = recovery ? resolveDocumentRecovery(recovery, doc) : null;
      const shouldRecover = recoveryResolution === "restore" && !doc.creativeWorkId;
      const hasRecoveryConflict = Boolean(
        recovery
        && (recoveryResolution === "conflict" || (recoveryResolution === "restore" && doc.creativeWorkId))
      );
      if (hasRecoveryConflict && recovery) {
        revisionConflictDocRef.current = doc.id;
        conflictServerDocRef.current.set(doc.id, doc);
        conflictLocalValueRef.current.set(doc.id, {
          title: recovery.title,
          content: recovery.content
        });
        conflictBaseUpdatedAtRef.current.set(doc.id, recovery.serverUpdatedAt);
      } else if (revisionConflictDocRef.current === doc.id) {
        revisionConflictDocRef.current = "";
        conflictLocalValueRef.current.delete(doc.id);
        conflictBaseUpdatedAtRef.current.delete(doc.id);
        conflictServerDocRef.current.delete(doc.id);
      }
      const openedDoc: DocFull = shouldRecover && recovery
        ? {
            ...doc,
            title: recovery.title,
            content: recovery.content,
            completedAt: null
          }
        : doc;
      if (recoveryResolution === "discard") clearRecoverySnapshot(doc.id);
      setRecoveryConflict(hasRecoveryConflict ? recovery : null);
      setActive(openedDoc);
      activeIdRef.current = doc.id;
      latestDocumentValueRef.current.set(doc.id, {
        title: openedDoc.title,
        content: openedDoc.content
      });
      contentRevisionRef.current = 0;
      setSaveState(hasRecoveryConflict ? "conflict" : shouldRecover ? "dirty" : "idle");
      setSavedAt(doc.updatedAt);
      setWritingView("edit");
      setCompletionError("");
      setListOpen(false);
      if (list) {
        setDocs(list.map((item) => item.id === doc.id && shouldRecover
          ? { ...item, title: openedDoc.title, completedAt: null }
          : item));
      }
      if (shouldRecover) scheduleSave(doc.id, openedDoc.title, openedDoc.content, true);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      finishDocumentTransition(requestId);
    }
  }, [beginDocumentTransition, finishDocumentTransition, flushSave, scheduleSave]);

  const createDoc = useCallback(async () => {
    if (documentActionRef.current) return;
    documentActionRef.current = true;
    setDocumentActionBusy(true);
    const requestId = ++documentRequestRef.current;
    const previousId = activeIdRef.current;
    setFatal("");
    beginDocumentTransition();
    try {
      if (!(await flushSave(previousId)) || requestId !== documentRequestRef.current) return;
      const anonymousSeed = await ensureAnonymousBootstrap();
      const { doc } = await requestJson<{ doc: DocFull }>("/api/public/writing/docs", {
        method: "POST",
        headers: { [ANON_CREATION_SEED_HEADER]: anonymousSeed }
      });
      setDocs((current) => [{
        id: doc.id,
        title: doc.title,
        completedAt: doc.completedAt,
        creativeWorkId: doc.creativeWorkId,
        publicationBlockedAt: doc.publicationBlockedAt,
        updatedAt: doc.updatedAt
      }, ...current]);
      // The POST may finish after the user selected another document. Keep the
      // created document in the list, but do not steal focus from the newer action.
      if (requestId !== documentRequestRef.current) return;
      setActive(doc);
      activeIdRef.current = doc.id;
      latestDocumentValueRef.current.set(doc.id, { title: doc.title, content: doc.content });
      serverUpdatedAtRef.current.set(doc.id, doc.updatedAt);
      contentRevisionRef.current = 0;
      setSaveState("idle");
      setSavedAt(doc.updatedAt);
      setRecoveryConflict(null);
      setWritingView("edit");
      setCompletionError("");
      setTimeout(() => {
        if (activeIdRef.current === doc.id && !documentTransitionRef.current) {
          titleRef.current?.focus();
        }
      }, 50);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      documentActionRef.current = false;
      setDocumentActionBusy(false);
      finishDocumentTransition(requestId);
    }
  }, [beginDocumentTransition, finishDocumentTransition, flushSave]);

  const deleteDoc = useCallback(async (id: string) => {
    const target = docs.find((item) => item.id === id);
    if (!target) return;
    if (
      documentActionRef.current
      || recoveryActionRef.current
      || revisionConflictDocRef.current === id
      || recoveryConflict?.docId === id
    ) {
      setFatal("请先处理当前文档的版本冲突，再删除文档。");
      return;
    }
    if (!window.confirm(`删除「${target?.title || "无标题"}」？此操作不可恢复。`)) return;
    documentActionRef.current = true;
    setDocumentActionBusy(true);
    const isActive = activeIdRef.current === id;
    const requestId = isActive ? ++documentRequestRef.current : 0;
    if (isActive) beginDocumentTransition();
    try {
      if (isActive && !(await flushSave(id))) return;
      await requestJson(`/api/public/writing/docs/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: serverUpdatedAtRef.current.get(id) || target.updatedAt
        })
      });
      clearRecoverySnapshot(id);
      serverUpdatedAtRef.current.delete(id);
      latestDocumentValueRef.current.delete(id);
      saveCoordinatorRef.current?.clear(id);
      conflictLocalValueRef.current.delete(id);
      conflictBaseUpdatedAtRef.current.delete(id);
      conflictServerDocRef.current.delete(id);
      const rest = docs.filter((item) => item.id !== id);
      setDocs(rest);
      if (isActive) {
        activeIdRef.current = "";
        // A full reload gives the existing initialization barrier authority to
        // open the next document (or create one) without ever rendering the
        // deleted document as editable between two async transitions.
        window.location.reload();
      }
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      documentActionRef.current = false;
      setDocumentActionBusy(false);
      if (isActive) finishDocumentTransition(requestId);
    }
  }, [beginDocumentTransition, docs, finishDocumentTransition, flushSave, recoveryConflict]);

  // 卸载前尽力保存
  useEffect(() => {
    const persistPending = () => {
      const id = activeIdRef.current;
      const pending = saveCoordinatorRef.current?.peek(id)?.value;
      if (!id || !pending) return;
      // This is the durable fallback for large bodies: keepalive and beacon are
      // best-effort only and commonly reject payloads around/above 64 KiB.
      persistRecoverySnapshot(
        id,
        pending,
        serverUpdatedAtRef.current.get(id) || "",
        editorSessionIdRef.current
      );
      const body = JSON.stringify({
        ...pending,
        expectedUpdatedAt: serverUpdatedAtRef.current.get(id)
      });
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
    if (
      writingMode !== "assist"
      || recoveryConflict
      || recoveryActionRef.current
      || documentTransitionRef.current
      || task.docId !== activeIdRef.current
      || revisionConflictDocRef.current === activeIdRef.current
    ) return;
    const requestId = ++aiRequestRef.current;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAi({ ...task, requestId, status: "loading", output: "", error: "" });
    try {
      const instruction = task.mode === "continue"
        ? "从【当前文稿】的结尾自然续写 1-3 段：保持既有语言、口吻与 markdown 格式。只能沿用原稿已有事实和逻辑，不得新增人物、数字、时间、引语、事例或来源；需要新素材时用【待补充：……】。只输出续写的新内容，不重复原文，不解释。"
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
  }, [active?.title, active?.content, customModel, recoveryConflict, writingMode]);

  const closeAi = useCallback(() => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAi(null);
  }, []);

  const selectWritingMode = (next: WritingMode) => {
    if (documentTransitionRef.current || recoveryActionRef.current) return;
    if (next === writingMode) return;
    if (next === "manual") closeAi();
    setWritingMode(next);
  };

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

  const selectionEditor = liveEditor(editorRef.current);
  const aiSelectionIsCurrent = Boolean(
    ai
    && ai.mode === "selection"
    && active
    && selectionEditor
    && ai.from >= 0
    && ai.to >= ai.from
    && ai.to <= selectionEditor.state.doc.content.size
    && isAiSelectionCurrent(
      { docId: ai.docId, revision: ai.revision, source: ai.source },
      {
        docId: active.id,
        revision: contentRevisionRef.current,
        selectedText: selectionEditor.state.doc.textBetween(ai.from, ai.to, "\n")
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
    const editor = liveEditor(editorRef.current);
    if (
      !editor
      || !editor.isEditable
      || !ai
      || ai.status !== "done"
      || !ai.output
      || recoveryConflict
      || recoveryActionBusy
      || documentTransitionRef.current
      || ai.docId !== activeIdRef.current
      || revisionConflictDocRef.current === activeIdRef.current
    ) return;
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

  const loadManualPublicationOptions = useCallback(async () => {
    if (manualGenres.length > 0 && manualDepths) return;
    setCompletionBusy("options");
    try {
      const data = await requestJson<{
        genres: ManualGenre[];
        depths: Record<ManualDepth, ManualDepthMeta>;
      }>("/api/public/creation/genres");
      setManualGenres(data.genres);
      setManualDepths(data.depths);
      setManualGenreId((current) => current || data.genres[0]?.id || "");
    } finally {
      setCompletionBusy((current) => current === "options" ? null : current);
    }
  }, [manualDepths, manualGenres.length]);

  const completeAndPreview = useCallback(async () => {
    if (
      !active
      || documentTransitionRef.current
      || documentActionRef.current
      || active.id !== activeIdRef.current
    ) return;
    setCompletionError("");
    if (!active.title.trim()) {
      setCompletionError("请先填写标题。");
      titleRef.current?.focus();
      return;
    }
    if (!active.content.trim()) {
      setCompletionError("请先写下正文。");
      liveEditor(editorRef.current)?.commands.focus("start");
      return;
    }

    const docId = active.id;
    const requestId = ++documentRequestRef.current;
    documentActionRef.current = true;
    setDocumentActionBusy(true);
    beginDocumentTransition();
    closeAi();
    setCompletionBusy("complete");
    try {
      if (!(await flushSave(docId))) {
        if (revisionConflictDocRef.current === docId) return;
        throw new Error("文档还没有成功保存，请等待自动重试或检查网络。");
      }
      if (requestId !== documentRequestRef.current || activeIdRef.current !== docId) return;
      const { doc } = await requestJson<{ doc: DocFull }>(
        `/api/public/writing/docs/${docId}/complete`,
        { method: "POST" }
      );
      if (
        doc.id !== docId
        || requestId !== documentRequestRef.current
        || activeIdRef.current !== docId
      ) return;
      serverUpdatedAtRef.current.set(doc.id, doc.updatedAt);
      setActive((current) => current?.id === docId ? { ...current, ...doc } : current);
      setDocs((current) => current.map((item) => item.id === doc.id ? { ...item, ...doc } : item));
      setSavedAt(doc.updatedAt);
      setSaveState("saved");
      setWritingView("preview");
      if (!doc.publicationBlockedAt) {
        try {
          await loadManualPublicationOptions();
        } catch (error) {
          setCompletionError(
            error instanceof Error
              ? `预览已保存，但发布选项加载失败：${error.message}`
              : "预览已保存，但发布选项加载失败。"
          );
        }
      }
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : String(error));
    } finally {
      documentActionRef.current = false;
      setDocumentActionBusy(false);
      setCompletionBusy((current) => current === "complete" ? null : current);
      finishDocumentTransition(requestId);
    }
  }, [active, beginDocumentTransition, closeAi, finishDocumentTransition, flushSave, loadManualPublicationOptions]);

  const handoffToCommunityDraft = useCallback(async () => {
    if (
      !active
      || documentTransitionRef.current
      || documentActionRef.current
      || active.id !== activeIdRef.current
    ) return;
    if (active.publicationBlockedAt) {
      setCompletionError("这份私有原稿仍可继续编辑和导出，但社区交接已被内容治理锁定。");
      return;
    }
    if (active.creativeWorkId) {
      window.location.assign(`/create?work=${encodeURIComponent(active.creativeWorkId)}`);
      return;
    }
    if (!manualGenreId) {
      setCompletionError("请先选择题材标尺。");
      return;
    }

    const docId = active.id;
    const requestId = ++documentRequestRef.current;
    documentActionRef.current = true;
    setDocumentActionBusy(true);
    beginDocumentTransition();
    setCompletionError("");
    setCompletionBusy("handoff");
    try {
      const data = await requestJson<{ workId: string; url: string }>(
        `/api/public/writing/docs/${docId}/community-draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            genreId: manualGenreId,
            depth: manualDepth,
            expectedUpdatedAt: active.updatedAt
          })
        }
      );
      if (requestId !== documentRequestRef.current || activeIdRef.current !== docId) return;
      // 从这一刻起 CreativeWork 是唯一后续编辑源。先在客户端标记锁定，
      // 即使导航被浏览器拦截，也不会继续编辑旧 WritingDoc。
      setActive((current) => current?.id === docId ? { ...current, creativeWorkId: data.workId } : current);
      setDocs((current) => current.map((item) =>
        item.id === docId ? { ...item, creativeWorkId: data.workId } : item
      ));
      window.location.assign(data.url);
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : String(error));
    } finally {
      documentActionRef.current = false;
      setDocumentActionBusy(false);
      setCompletionBusy((current) => current === "handoff" ? null : current);
      finishDocumentTransition(requestId);
    }
  }, [active, beginDocumentTransition, finishDocumentTransition, manualDepth, manualGenreId]);

  if (loading) {
    return <div className="writing-studio writing-loading" aria-busy="true"><p className="muted">正在打开写作台…</p></div>;
  }
  if (fatal && !active) {
    return <div className="writing-studio"><p className="form-error" role="alert">{fatal}</p></div>;
  }
  if (!active) return null;

  const editorLocked = Boolean(recoveryConflict)
    || recoveryActionBusy
    || documentTransitionBusy
    || documentActionBusy;
  const documentControlsLocked = documentTransitionBusy
    || documentActionBusy
    || completionBusy !== null
    || Boolean(recoveryConflict);

  const saveLabel =
    saveState === "saving" ? "保存中…"
    : saveState === "dirty" ? "编辑中…"
    : saveState === "conflict" ? "检测到版本冲突，请选择保留哪一份"
    : saveState === "error" ? "保存失败，稍后自动重试"
    : savedAt ? `已保存 ${relativeTime(savedAt)}` : "";

  return (
    <div className="writing-studio">
      <h1 className="sr-only">写作台</h1>
      {fatal ? <p className="form-error" role="alert">{fatal}</p> : null}
      <button
        className="writing-list-toggle button secondary"
        type="button"
        aria-expanded={listOpen}
        aria-controls="writing-document-sidebar"
        onClick={() => setListOpen((v) => !v)}
      >
        文档（{docs.length}{docsNextCursor ? "+" : ""}）
      </button>

      <aside id="writing-document-sidebar" className={`writing-sidebar${listOpen ? " open" : ""}`} aria-label="文档与写作设置">
        <div className="writing-sidebar-head">
          <strong>我的文档</strong>
          <button className="text-link" type="button" disabled={documentControlsLocked} onClick={() => void createDoc()}>+ 新建</button>
        </div>
        <ul className="writing-doc-list">
          {docs.map((doc) => (
            <li key={doc.id} className={doc.id === active.id ? "active" : ""}>
              <button
                className="writing-doc-item"
                type="button"
                aria-current={doc.id === active.id ? "true" : undefined}
                disabled={documentControlsLocked}
                onClick={() => void openDoc(doc.id)}
              >
                <span className="writing-doc-title">{doc.title || "无标题"}</span>
                <span className="writing-doc-time">{relativeTime(doc.updatedAt)}</span>
              </button>
              <button className="writing-doc-delete" type="button" disabled={documentControlsLocked} aria-label={`删除文档：${doc.title || "无标题"}`} title="删除" onClick={() => void deleteDoc(doc.id)}>×</button>
            </li>
          ))}
        </ul>
        {docsNextCursor ? (
          <button
            className="button secondary"
            type="button"
            data-testid="writing-load-more-docs"
            disabled={documentControlsLocked || docsLoadingMore}
            aria-busy={docsLoadingMore}
            onClick={() => void loadMoreDocs()}
          >
            {docsLoadingMore ? "正在加载更多文档…" : "加载更多文档"}
          </button>
        ) : null}

        {writingMode === "assist" ? (
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
        ) : (
          <p className="writing-manual-note">纯手写模式不会调用 AI。你的文字只会自动保存到私有文档。</p>
        )}
      </aside>

      <div className="writing-canvas">
        {recoveryConflict?.docId === active.id ? (
          <section className="writing-recovery-conflict" role="alert" data-testid="writing-recovery-conflict">
            <div>
              <strong>发现一份未保存的本地稿</strong>
              <p>
                服务器版也已在其他页面更新。为避免自动覆盖，已同时保留两份内容，请选择要继续使用的版本。
              </p>
            </div>
            <div className="row-actions">
              <button
                className="button"
                type="button"
                data-testid="writing-restore-local"
                disabled={recoveryActionBusy}
                aria-busy={recoveryActionBusy}
                onClick={() => void restoreConflictingRecovery()}
              >
                {recoveryActionBusy ? "正在读取版本…" : "恢复本地未保存稿"}
              </button>
              <button
                className="button secondary"
                type="button"
                data-testid="writing-keep-server"
                disabled={recoveryActionBusy}
                onClick={() => void keepServerRecoveryVersion()}
              >
                保留服务器版
              </button>
            </div>
          </section>
        ) : null}
        {active.creativeWorkId ? (
          <section className="writing-submitted-state" data-testid="writing-submitted-state">
            <div>
              <p className="eyebrow">已完成交接</p>
              <h2>这篇文章已进入评分与发布流程</h2>
              <p className="muted-block">
                为避免两份草稿互相覆盖，这份手写文档已锁定为原始快照。后续修改、评分和公开都在作品草稿中进行。
              </p>
            </div>
            <article className="writing-finish-preview">
              <h1>{active.title || "无标题"}</h1>
              <div className="prose" dangerouslySetInnerHTML={{ __html: markdownToHtml(active.content) }} />
            </article>
            <div className="row-actions">
              <a
                className="button"
                data-testid="writing-continue-publication"
                href={`/create?work=${encodeURIComponent(active.creativeWorkId)}`}
              >
                继续评分与发布
              </a>
              <a
                className="button secondary"
                href={`data:text/markdown;charset=utf-8,${encodeURIComponent(`# ${active.title || "无标题"}\n\n${active.content}`)}`}
                download={`${(active.title || "无标题").slice(0, 60)}.md`}
              >
                导出原始手写稿
              </a>
            </div>
          </section>
        ) : writingView === "preview" ? (
          <section className="writing-finish-stage" data-testid="writing-finish-preview">
            <div className="writing-finish-head">
              <div>
                <p className="eyebrow">完成预览</p>
                <h2>确认这是你要继续处理的版本</h2>
              </div>
              <span className="tag">已保存到私有文档</span>
            </div>

            <article className="writing-finish-preview" aria-label="手写文章预览">
              <h1>{active.title || "无标题"}</h1>
              <div className="prose" dangerouslySetInnerHTML={{ __html: markdownToHtml(active.content) }} />
            </article>

            <div className="row-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setWritingView("edit");
                  setCompletionError("");
                  setTimeout(() => {
                    const editor = liveEditor(editorRef.current);
                    if (editor) {
                      editor.commands.focus("end");
                    }
                  }, 0);
                }}
              >
                返回修改
              </button>
              <a
                className="button secondary"
                href={`data:text/markdown;charset=utf-8,${encodeURIComponent(`# ${active.title || "无标题"}\n\n${active.content}`)}`}
                download={`${(active.title || "无标题").slice(0, 60)}.md`}
              >
                导出 Markdown
              </a>
            </div>

            <section className="writing-publication-step" aria-labelledby="writing-publication-heading">
              <div>
                <h3 id="writing-publication-heading">
                  {active.publicationBlockedAt ? "社区交接已锁定" : "下一步：准备评分与发布"}
                </h3>
                <p className="muted">
                  {active.publicationBlockedAt
                    ? "对应公开副本已被内容治理永久删除，因此不能再从这份原稿一键创建社区作品。"
                    : "完成和交接都不会调用 AI，也不会自动公开。选好题材标尺后，你会先进入可编辑的作品草稿；之后只有你主动点击才会 AI 评分或公开。"}
                </p>
              </div>

              {active.publicationBlockedAt ? (
                <div className="muted-block creation-error" role="status" data-testid="writing-publication-blocked">
                  私有原稿仍归你所有，可继续编辑、自动保存和导出；治理锁只限制这份原稿再次交接到社区。你也可以新建另一篇独立文档。
                </div>
              ) : null}

              {!active.publicationBlockedAt && (manualGenres.length > 0 ? (
                <div className="field">
                  <label htmlFor="manual-writing-genre">题材与评分标尺</label>
                  <select
                    id="manual-writing-genre"
                    value={manualGenreId}
                    onChange={(event) => setManualGenreId(event.target.value)}
                  >
                    {manualGenres.map((genre) => (
                      <option key={genre.id} value={genre.id}>
                        {genre.name}（公开门槛 {genre.threshold} 分）
                      </option>
                    ))}
                  </select>
                  {manualGenres.find((genre) => genre.id === manualGenreId)?.description ? (
                    <span className="muted">{manualGenres.find((genre) => genre.id === manualGenreId)?.description}</span>
                  ) : null}
                </div>
              ) : (
                <p className="muted" role="status">
                  {completionBusy === "options" ? "正在加载题材标尺…" : "暂时没有可用的题材标尺。"}
                </p>
              ))}

              {!active.publicationBlockedAt && manualDepths ? (
                <fieldset className="writing-depth-choice">
                  <legend>评分时按哪种篇幅预期检查</legend>
                  {(Object.keys(manualDepths) as ManualDepth[]).map((key) => (
                    <label key={key} className={manualDepth === key ? "selected" : ""}>
                      <input
                        type="radio"
                        name="manual-writing-depth"
                        value={key}
                        checked={manualDepth === key}
                        onChange={() => setManualDepth(key)}
                      />
                      <span>
                        <strong>{manualDepths[key].label}</strong>
                        <small>{manualDepths[key].description}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null}

              {completionError ? <p className="form-error" role="alert">{completionError}</p> : null}
              {!active.publicationBlockedAt && active.content.length > MAX_SCORABLE_WORK_CONTENT_LENGTH ? (
                <p className="form-error" role="alert">
                  你的私有原稿已完整保存，但社区评分必须覆盖全文，最多支持 {MAX_SCORABLE_WORK_CONTENT_LENGTH} 个字符。
                  你仍可继续写作或导出；精简到上限以内后即可交接。
                </p>
              ) : null}
              {!active.publicationBlockedAt ? (
                <button
                  className="button"
                  data-testid="writing-submit-community"
                  type="button"
                  disabled={
                    completionBusy !== null
                    || editorLocked
                    || !manualGenreId
                    || active.content.length > MAX_SCORABLE_WORK_CONTENT_LENGTH
                  }
                  aria-busy={completionBusy === "handoff"}
                  onClick={() => void handoffToCommunityDraft()}
                >
                  {completionBusy === "handoff" ? "正在创建作品草稿…" : "继续到评分与发布"}
                </button>
              ) : null}
            </section>
          </section>
        ) : (
          <>
        {active.publicationBlockedAt ? (
          <section className="muted-block creation-error" role="status" data-testid="writing-publication-blocked">
            <strong>这份原稿的社区交接已锁定。</strong>{" "}
            对应公开副本已被内容治理永久删除；原稿仍是你的私有文档，可继续编辑、自动保存和导出。
          </section>
        ) : null}
        <section className="writing-mode-picker" aria-label="写作模式">
          <div className="writing-mode-seg" role="radiogroup" aria-label="选择写作模式">
            <button
              type="button"
              role="radio"
              className={`writing-mode-tab${writingMode === "manual" ? " active" : ""}`}
              aria-checked={writingMode === "manual"}
              disabled={editorLocked}
              onClick={() => selectWritingMode("manual")}
            >
              纯手写
            </button>
            <button
              type="button"
              role="radio"
              className={`writing-mode-tab${writingMode === "assist" ? " active" : ""}`}
              aria-checked={writingMode === "assist"}
              disabled={editorLocked}
              onClick={() => selectWritingMode("assist")}
            >
              AI 辅助
            </button>
          </div>
          <p className="muted writing-mode-note">
            {writingMode === "manual"
              ? "纯手写：不发送任何 AI 请求。选中文字后可用左侧手柄或 / 命令排版。"
              : "AI 只处理你主动选中的文字，结果需你确认后才写入。"}
          </p>
        </section>
        <div className="writing-meta-row">
          <span className={`writing-save-state state-${saveState}`} role="status" aria-live="polite">{saveLabel}</span>
          <span className="writing-word-count">{wordCount} 字</span>
          <button
            className="text-link writing-complete-action"
            data-testid="writing-complete-button"
            type="button"
            disabled={completionBusy !== null || editorLocked}
            onClick={() => void completeAndPreview()}
          >
            {completionBusy === "complete" ? "正在完成…" : "完成并预览"}
          </button>
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
          maxLength={200}
          readOnly={editorLocked}
          value={active.title}
          onChange={(event) => {
            if (documentTransitionRef.current || active.id !== activeIdRef.current) return;
            const title = event.target.value.replace(/\n/g, "");
            const latest = latestDocumentValueRef.current.get(active.id) || {
              title: active.title,
              content: active.content
            };
            setActive((current) => current?.id === active.id
              ? { ...current, title, completedAt: null }
              : current);
            scheduleSave(active.id, title, latest.content);
            event.target.style.height = "auto";
            event.target.style.height = `${event.target.scrollHeight}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "ArrowDown") {
              event.preventDefault();
              liveEditor(editorRef.current)?.commands.focus("start");
            }
          }}
        />

        {completionError ? <p className="form-error writing-completion-error" role="alert">{completionError}</p> : null}

        <NotionEditor
          docId={active.id}
          initialMarkdown={active.content}
          editable={!editorLocked}
          aiEnabled={writingMode === "assist" && !editorLocked}
          onReady={(editor) => { editorRef.current = editor; }}
          onMarkdownChange={(loadedDocId, markdown) => {
            if (loadedDocId !== activeIdRef.current || documentTransitionRef.current) return;
            const latest = latestDocumentValueRef.current.get(loadedDocId) || {
              title: active.title,
              content: active.content
            };
            contentRevisionRef.current += 1;
            setActive((current) => current?.id === loadedDocId
              ? { ...current, content: markdown, completedAt: null }
              : current);
            scheduleSave(loadedDocId, latest.title, markdown);
          }}
          onAiSelection={onAiSelection}
          onAiContinue={onAiContinue}
        />

        {ai && !editorLocked ? (
          <div className={`ai-review-card status-${ai.status}`} role="region" aria-label="AI 结果">
            <div className="ai-review-head">
              <strong>AI {ai.label}</strong>
              <button className="text-link" type="button" onClick={closeAi}>{ai.status === "loading" ? "取消" : "关闭"}</button>
            </div>
            {ai.status === "loading" ? (
              <TaskProgress
                label={`AI 正在${ai.label}`}
                stage="正在读取你选择的文字并生成建议"
                active
              />
            ) : null}
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
                  <button className="text-link" type="button" onClick={closeAi}>舍弃</button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
          </>
        )}
      </div>
    </div>
  );
}
