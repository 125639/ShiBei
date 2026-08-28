"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { I18nText } from "./I18nText";
import { TaskProgress } from "./TaskProgress";

type BulkPost = {
  id: string;
  title: string;
  summary: string;
  status: string;
  videosCount: number;
  sortOrder: number;
  updatedAt: string;
  publicationBlockedReason: string | null;
  pendingRevision: boolean;
};

type RepairItem = {
  jobId: string;
  jobStatus: string;
  updatedAt: string;
  version: 1;
  postId: string;
  title: string;
  state: "QUEUED" | "RUNNING" | "PUBLISHED" | "FAILED";
  attempts: number;
  maxAttempts: number;
  message: string;
  reason: string | null;
  guidance: string | null;
  rounds: Array<{ round: number; action: "audit" | "regenerate" | "repair"; reason: string }>;
};

type RepairBatch = {
  batchId: string;
  complete: boolean;
  completed: number;
  total: number;
  published: number;
  failed: number;
  results: RepairItem[];
};

const ACTIVE_REPAIR_BATCH_KEY = "shibei:active-post-repair-batch";
const REPAIR_POLL_TIMEOUT_MS = 15_000;
const REPAIR_POLL_INTERVAL_MS = 5_000;
const REPAIR_POLL_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000, 30_000] as const;

function readActiveRepairBatchId() {
  try {
    return window.localStorage.getItem(ACTIVE_REPAIR_BATCH_KEY) || "";
  } catch {
    return "";
  }
}

function saveActiveRepairBatchId(batchId: string) {
  try {
    window.localStorage.setItem(ACTIVE_REPAIR_BATCH_KEY, batchId);
    return true;
  } catch {
    return false;
  }
}

function clearActiveRepairBatchId() {
  try {
    window.localStorage.removeItem(ACTIVE_REPAIR_BATCH_KEY);
  } catch {
    // 浏览器禁用本地存储时，当前标签页仍可正常跟踪和停止任务。
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

const STATUS_LABELS: Record<string, { zh: string; en: string }> = {
  DRAFT: { zh: "草稿", en: "Draft" },
  PUBLISHED: { zh: "已发布", en: "Published" },
  ARCHIVED: { zh: "已归档", en: "Archived" }
};

const REPAIR_STATE_LABELS: Record<RepairItem["state"], string> = {
  QUEUED: "等待中",
  RUNNING: "返修中",
  PUBLISHED: "已通过并发布",
  FAILED: "已停止，仍为草稿"
};

export function BulkPostActions({ posts, allowAiRepair = true }: { posts: BulkPost[]; allowAiRepair?: boolean }) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [action, setAction] = useState("delete");
  const [submitting, setSubmitting] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState("");
  const [repairBatch, setRepairBatch] = useState<RepairBatch | null>(null);
  const [operationError, setOperationError] = useState("");
  const [operationNotice, setOperationNotice] = useState("");

  // 翻页/筛选后列表会变化，丢弃已不在当前页的选择，避免计数与提交内容错乱。
  const validIds = new Set(posts.map((post) => post.id));
  const activeSelectedIds = selectedIds.filter((id) => validIds.has(id));
  const allSelected = posts.length > 0 && activeSelectedIds.length === posts.length;
  const backgroundActive = Boolean(activeBatchId) || submitting;

  useEffect(() => {
    if (!allowAiRepair) {
      clearActiveRepairBatchId();
      return;
    }
    const saved = readActiveRepairBatchId();
    if (/^[a-zA-Z0-9_-]{1,120}$/.test(saved)) {
      const resumeTimer = window.setTimeout(() => setActiveBatchId(saved), 0);
      return () => window.clearTimeout(resumeTimer);
    } else if (saved) {
      clearActiveRepairBatchId();
    }
  }, [allowAiRepair]);

  useEffect(() => {
    if (!allowAiRepair || !activeBatchId) return;
    let cancelled = false;
    let timer: number | undefined;
    let inFlightController: AbortController | undefined;
    let transientFailures = 0;

    const stopTracking = (message: string, isError: boolean) => {
      if (cancelled) return;
      clearActiveRepairBatchId();
      setActiveBatchId((current) => current === activeBatchId ? "" : current);
      if (isError) {
        setOperationError(message);
        setOperationNotice("");
      } else {
        setOperationError("");
        setOperationNotice(message);
      }
    };

    const schedulePoll = (delay: number) => {
      if (cancelled) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        void poll();
      }, delay);
    };

    const poll = async () => {
      if (cancelled || inFlightController) return;
      const controller = new AbortController();
      inFlightController = controller;
      const timeout = window.setTimeout(() => controller.abort(), REPAIR_POLL_TIMEOUT_MS);
      try {
        const response = await fetch(`/api/admin/posts/bulk-repair?batchId=${encodeURIComponent(activeBatchId)}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const data = (await response.json().catch(() => ({}))) as Partial<RepairBatch> & { error?: string };
        if (!response.ok) {
          const reason = data.error || `读取返修进度失败（HTTP ${response.status}）`;
          if ([400, 401, 403, 404].includes(response.status)) {
            stopTracking(`${reason}。已停止此页面的进度跟踪并解除操作锁定；后台任务没有因此被取消。`, true);
            return;
          }
          throw new Error(reason);
        }
        if (
          data.batchId !== activeBatchId
          || typeof data.complete !== "boolean"
          || typeof data.completed !== "number"
          || typeof data.total !== "number"
          || typeof data.published !== "number"
          || typeof data.failed !== "number"
          || !Array.isArray(data.results)
        ) {
          throw new Error("返修进度响应格式无效");
        }
        if (cancelled) return;
        transientFailures = 0;
        setRepairBatch(data as RepairBatch);
        setOperationError("");
        setOperationNotice("");
        if (data.complete) {
          clearActiveRepairBatchId();
          setActiveBatchId("");
          router.refresh();
          return;
        }
        schedulePoll(REPAIR_POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        transientFailures += 1;
        const reason = isAbortError(error)
          ? "读取返修进度超过 15 秒"
          : error instanceof Error ? error.message : String(error);
        if (transientFailures >= REPAIR_POLL_BACKOFF_MS.length) {
          stopTracking(`${reason}。连续 ${transientFailures} 次无法读取进度，已停止此页面的跟踪并解除操作锁定；后台任务仍会继续。`, true);
          return;
        }
        setOperationError(`${reason}，将在 ${REPAIR_POLL_BACKOFF_MS[transientFailures - 1] / 1000} 秒后重试（${transientFailures}/${REPAIR_POLL_BACKOFF_MS.length}）。`);
        schedulePoll(REPAIR_POLL_BACKOFF_MS[transientFailures - 1]);
      } finally {
        window.clearTimeout(timeout);
        if (inFlightController === controller) inFlightController = undefined;
      }
    };

    const resumeWhenVisible = () => {
      if (document.visibilityState === "visible" && timer && !inFlightController) {
        schedulePoll(100);
      }
    };
    void poll();
    document.addEventListener("visibilitychange", resumeWhenVisible);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      inFlightController?.abort();
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, [activeBatchId, allowAiRepair, router]);

  function stopRepairTracking() {
    clearActiveRepairBatchId();
    setActiveBatchId("");
    setOperationError("");
    setOperationNotice("已停止在此页面跟踪进度；后台返修任务没有取消，仍会继续执行。你可以稍后刷新任务页面查看结果。");
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? posts.map((post) => post.id) : []);
  }

  function togglePost(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }

  async function startRepairBatch(postIds: string[]) {
    if (!allowAiRepair || !postIds.length || backgroundActive) return;
    const previousTitles = new Map(repairBatch?.results.map((item) => [item.postId, item.title]) || []);
    const ineligibleIds = postIds.filter((postId) => {
      const post = posts.find((item) => item.id === postId);
      if (post) return post.status !== "DRAFT";
      // 翻页或筛选刷新后，当前 props 可能已不含这篇文章；仅信任本批次明确标为
      // FAILED（按接口契约仍为草稿）的结果用于“重新尝试”，其余缺失文章一律拒绝。
      return !repairBatch?.results.some((item) => item.postId === postId && item.state === "FAILED");
    });
    if (ineligibleIds.length) {
      setOperationNotice("");
      setOperationError(`AI 返修只处理草稿；所选内容中有 ${ineligibleIds.length} 篇不是草稿或状态无法确认，请取消选择后再试。`);
      return;
    }
    setSubmitting(true);
    setOperationError("");
    setOperationNotice("");
    setRepairBatch({
      batchId: "",
      complete: false,
      completed: 0,
      total: postIds.length,
      published: 0,
      failed: 0,
      results: postIds.map((postId) => ({
        jobId: "",
        jobStatus: "QUEUED",
        updatedAt: new Date().toISOString(),
        version: 1,
        postId,
        title: posts.find((post) => post.id === postId)?.title || previousTitles.get(postId) || "文章",
        state: "QUEUED",
        attempts: 0,
        maxAttempts: 3,
        message: "正在建立后台返修任务",
        reason: null,
        guidance: null,
        rounds: []
      }))
    });
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), REPAIR_POLL_TIMEOUT_MS);
    try {
      const response = await fetch("/api/admin/posts/bulk-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds }),
        signal: controller.signal
      });
      const data = (await response.json().catch(() => ({}))) as { batchId?: string; error?: string };
      if (!response.ok || !data.batchId) throw new Error(data.error || "建立 AI 返修批次失败");
      // 本地存储只用于跨页面恢复；即使被浏览器禁用，成功建立的批次仍在当前标签页继续跟踪。
      saveActiveRepairBatchId(data.batchId);
      setActiveBatchId(data.batchId);
      setSelectedIds((current) => current.filter((id) => !postIds.includes(id)));
    } catch (error) {
      setRepairBatch(null);
      setOperationError(isAbortError(error)
        ? "建立返修批次的请求超过 15 秒，页面已解除锁定。服务器可能已经收到请求，请先到 AI 任务页面核对，避免立即重复建立批次。"
        : error instanceof Error ? error.message : String(error));
    } finally {
      window.clearTimeout(requestTimeout);
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!activeSelectedIds.length || backgroundActive) {
      event.preventDefault();
      return;
    }
    if (action === "delete" && !confirm(`确认删除选中的 ${activeSelectedIds.length} 篇文章？此操作不可撤销。`)) {
      event.preventDefault();
      return;
    }
    if (action === "publish" && allowAiRepair) {
      event.preventDefault();
      const nonDraftCount = activeSelectedIds.filter((id) => posts.find((post) => post.id === id)?.status !== "DRAFT").length;
      if (nonDraftCount) {
        setOperationNotice("");
        setOperationError(`AI 返修只处理草稿；所选内容中有 ${nonDraftCount} 篇不是草稿，请取消选择后再试。`);
        return;
      }
      void startRepairBatch(activeSelectedIds);
      return;
    }
    setSubmitting(true);
  }

  const ACTION_LABELS: Record<string, string> = {
    delete: "删除",
    publish: "建立 AI 审核任务",
    draft: "改为草稿",
    archive: "归档"
  };

  return (
    <form className="form-stack" action="/api/admin/posts/bulk" method="post" onSubmit={handleSubmit}>
      <div className="bulk-toolbar">
        <label>
          <input type="checkbox" checked={allSelected} disabled={backgroundActive} onChange={(event) => toggleAll(event.target.checked)} /> <I18nText zh="全选" en="Select all" />
        </label>
        <span className="muted" role="status"><I18nText zh={`已选择 ${activeSelectedIds.length} / ${posts.length}`} en={`Selected ${activeSelectedIds.length} / ${posts.length}`} /></span>
        <select name="action" value={action} disabled={backgroundActive} onChange={(event) => setAction(event.target.value)} aria-label="批量操作类型">
          <option value="delete">批量删除 / Delete</option>
          {allowAiRepair ? <option value="publish">AI 审核、返修并发布（最多 3 轮）</option> : null}
          <option value="draft">改为草稿 / To draft</option>
          <option value="archive">批量归档 / Archive</option>
        </select>
        <button
          className={action === "delete" ? "danger-button" : "button secondary"}
          disabled={!activeSelectedIds.length || backgroundActive}
          aria-busy={backgroundActive}
          type="submit"
        >
          {submitting ? `正在${ACTION_LABELS[action] || "执行"}…` : <I18nText zh="执行" en="Apply" />}
        </button>
        {activeBatchId && !repairBatch ? (
          <button className="button secondary" type="button" onClick={stopRepairTracking}>停止跟踪</button>
        ) : null}
      </div>

      {allowAiRepair && action === "publish" && !repairBatch ? (
        <p className="bulk-publish-explainer">
          系统会逐篇读取具体审核意见；可修复的引用、结构或格式问题最多由 AI 返修 3 轮，每轮都重新执行同一发布检查。资料不足时不会硬凑文章，而会明确告诉你需要补什么。
        </p>
      ) : null}

      {operationError ? <div className="form-error" role="alert">{operationError}</div> : null}
      {operationNotice ? <p className="bulk-publish-explainer" role="status">{operationNotice}</p> : null}
      {allowAiRepair && repairBatch ? (
        <RepairBatchPanel
          batch={repairBatch}
          active={Boolean(activeBatchId)}
          creating={submitting && !activeBatchId}
          onRetry={(postId) => void startRepairBatch([postId])}
          onStopTracking={stopRepairTracking}
          onDismiss={() => {
            clearActiveRepairBatchId();
            setActiveBatchId("");
            setRepairBatch(null);
            setOperationError("");
            setOperationNotice("");
          }}
        />
      ) : null}

      <div className="table-list">
        {posts.length === 0 ? (
          <p className="muted-block"><I18nText zh="没有匹配的文章。试试调整搜索关键词或状态筛选。" en="No matching posts — adjust the search keywords or status filter." /></p>
        ) : posts.map((post) => (
          <div className="table-item selectable-row" key={post.id}>
            <label className="row-checkbox" aria-label={`选择 ${post.title}`}>
              <input
                type="checkbox"
                name="postId"
                value={post.id}
                checked={activeSelectedIds.includes(post.id)}
                disabled={backgroundActive}
                onChange={(event) => togglePost(post.id, event.target.checked)}
              />
            </label>
            <div className="admin-post-list-copy">
              <strong>{post.title}</strong>
              <p className="muted">{post.summary}</p>
              <div className="meta-row">
                <span className={`tag status-${post.status.toLowerCase()}`}>
                  <I18nText zh={STATUS_LABELS[post.status]?.zh || post.status} en={STATUS_LABELS[post.status]?.en || post.status} />
                </span>
                {post.publicationBlockedReason ? (
                  <span className="tag admin-post-blocked-tag">
                    <I18nText zh="发布检查未通过" en="Publication check failed" />
                  </span>
                ) : null}
                {post.pendingRevision ? (
                  <span className="tag admin-post-blocked-tag">
                    <I18nText zh="有待审修改" en="Pending revision" />
                  </span>
                ) : null}
                <span className="tag"><I18nText zh="视频" en="videos" /> {post.videosCount}</span>
                <span className="tag"><I18nText zh="排序" en="order" /> {post.sortOrder}</span>
                <span className="muted"><I18nText zh="更新" en="Updated" /> {post.updatedAt.slice(0, 10)}</span>
              </div>
              {post.publicationBlockedReason ? (
                <p className="admin-post-blocked-reason"><strong>当前阻断原因：</strong>{post.publicationBlockedReason}</p>
              ) : null}
            </div>
            <Link className="button secondary" href={`/admin/posts/${post.id}`}><I18nText zh="打开编辑器" en="Open editor" /></Link>
          </div>
        ))}
      </div>
    </form>
  );
}

function RepairBatchPanel({
  batch,
  active,
  creating,
  onRetry,
  onStopTracking,
  onDismiss
}: {
  batch: RepairBatch;
  active: boolean;
  creating: boolean;
  onRetry: (postId: string) => void;
  onStopTracking: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className={`bulk-repair-panel${batch.complete ? " is-complete" : ""}`} aria-live="polite">
      <div className="bulk-repair-head">
        <div>
          <strong>{batch.complete ? "本批次处理完成" : creating ? "正在建立后台返修任务" : active ? "AI 正在按审核意见逐篇返修" : "已停止在此页面跟踪"}</strong>
          <p className="muted">
            {batch.complete
              ? `已发布 ${batch.published} 篇，停止 ${batch.failed} 篇；失败稿未公开。`
              : creating
                ? "正在提交所选草稿；请求完成后会自动开始跟踪每篇文章的审核与返修进度。"
              : active
                ? "每篇最多 3 轮；每轮修改后重新执行来源、引用与生成状态检查。你可以离开页面，任务会在后台继续。"
                : "这里只停止了前端进度刷新，后台返修任务没有取消。"}
          </p>
        </div>
        {creating ? (
          <span className="muted">正在提交…</span>
        ) : active ? (
          <button className="button secondary" type="button" onClick={onStopTracking}>停止跟踪</button>
        ) : (
          <button className="button secondary" type="button" onClick={onDismiss}>{batch.complete ? "收起结果" : "收起状态"}</button>
        )}
      </div>
      <TaskProgress
        label={batch.complete ? "返修与发布已结束" : "后台返修进度"}
        stage={`${batch.completed} / ${batch.total} 篇已结束`}
        value={batch.completed}
        max={Math.max(1, batch.total)}
        active={active || creating}
      />
      <div className="bulk-repair-results">
        {batch.results.map((item) => (
          <article className={`bulk-repair-result state-${item.state.toLowerCase()}`} key={item.jobId || item.postId}>
            <div className="bulk-repair-result-head">
              <div>
                <strong>{item.title}</strong>
                <div className="meta-row">
                  <span className={`status-pill status-${item.state === "PUBLISHED" ? "completed" : item.state === "FAILED" ? "failed" : item.state.toLowerCase()}`}>
                    {REPAIR_STATE_LABELS[item.state]}
                  </span>
                  <span className="muted">{item.attempts ? `已执行 ${item.attempts}/${item.maxAttempts} 轮` : "首次检查"}</span>
                </div>
              </div>
              <div className="row-actions">
                <Link className="button secondary" href={`/admin/posts/${item.postId}`}>打开文章</Link>
                {item.state === "FAILED" && batch.complete ? (
                  <button className="button secondary" type="button" onClick={() => onRetry(item.postId)}>重新尝试</button>
                ) : null}
              </div>
            </div>
            <p>{item.message}</p>
            {item.reason ? <p className="bulk-repair-reason"><strong>最终审核意见：</strong>{item.reason}</p> : null}
            {item.guidance ? <p className="bulk-repair-guidance"><strong>下一步：</strong>{item.guidance}</p> : null}
            {item.rounds.length ? (
              <details>
                <summary>查看每轮审核记录（{item.rounds.length}）</summary>
                <ol>
                  {item.rounds.map((round) => (
                    <li key={`${round.round}-${round.action}`}>
                      <strong>第 {round.round} 轮{round.action === "regenerate" ? "重新生成" : "定向返修"}：</strong>{round.reason}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
