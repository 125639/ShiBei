"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import type { JobStatus } from "@prisma/client";
import { I18nText } from "./I18nText";
import { StatusPill } from "./StatusPill";
import { TaskProgress } from "./TaskProgress";
import { getBatchProgress } from "@/lib/task-progress";

type ContentStyleOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

type PlannedTask = {
  keyword: string;
  reason: string;
  scope: "all" | "domestic" | "international";
  depth: "standard" | "long" | "deep";
  articleCount: number;
  topicId: string | null;
  styleId: string | null;
};

type RecurringPlan = {
  name: string;
  keywords: string;
  reason: string;
  cadence: "daily" | "weekly" | "weekdays";
  weekday: number;
  hour: number;
  mode: "single" | "daily_digest" | "weekly_roundup";
  scope: PlannedTask["scope"];
  depth: PlannedTask["depth"];
  articleCount: number;
  styleId: string | null;
};

type PlanResult = {
  summary: string;
  warnings: string[];
  tasks: PlannedTask[];
  recurring: RecurringPlan[];
  totalArticles: number;
  topics: Array<{ id: string; name: string }>;
  styles: Array<{ id: string; name: string }>;
};

type RecurringResult = {
  name: string;
  topicId: string | null;
  cadence: { zh: string; en: string };
  created: boolean;
};

type ExecuteResult = {
  executed: true;
  batchId: string;
  tasks: Array<PlannedTask & { jobId: string }>;
  recurring: RecurringResult[];
  totalArticles: number;
  warnings: string[];
};

export type AdminAiBatchView = {
  id: string;
  request: string;
  summary: string;
  createdAt: string;
  recurring: RecurringResult[];
  jobs: Array<{ id: string; status: JobStatus; keyword: string; error: string | null; updatedAt: string }>;
};

const EXAMPLE =
  "生成 4 篇财经博客（其中 1 篇与日本有关，其他与欧洲相关），再来 8 篇 AI 主题博客（几篇讲 AI 的最新进步，几篇分析欧洲 AI 发展迟缓的原因）。以后每周一上午来一篇 AI 周报。";

const CADENCE_LABELS: Record<RecurringPlan["cadence"], { zh: string; en: string }> = {
  daily: { zh: "每天", en: "Daily" },
  weekly: { zh: "每周", en: "Weekly" },
  weekdays: { zh: "工作日", en: "Weekdays" }
};

const MODE_LABELS: Record<RecurringPlan["mode"], { zh: string; en: string }> = {
  single: { zh: "独立成文", en: "Article" },
  daily_digest: { zh: "日报汇总", en: "Daily digest" },
  weekly_roundup: { zh: "周报汇总", en: "Weekly roundup" }
};

const WEEKDAYS_ZH = ["一", "二", "三", "四", "五", "六", "日"];

// 拆解计划在确认执行前只是 AI 返回的草案,没有写库;之前一离开 /admin/ai
// 页面(哪怕只是切到别的后台页看一眼)组件卸载,草案就随 state 一起消失,
// 得重新描述需求等 AI 重新想一遍。这里把草案镜像进 sessionStorage,离开
// 再回来时能恢复;确认执行后草案转正为真实批次,顺手清掉暂存。
const DRAFT_KEY = "shibei.admin-ai.draft";

type AiDraft = {
  request: string;
  scope: PlannedTask["scope"];
  depth: PlannedTask["depth"];
  articleCount: number;
  contentStyleId: string;
  feedback: string;
  plan: PlanResult;
};

function cadenceText(item: RecurringPlan) {
  const hour = String(item.hour).padStart(2, "0");
  if (item.cadence === "weekly") return `每周${WEEKDAYS_ZH[item.weekday - 1] || "一"} ${hour}:00`;
  return `${CADENCE_LABELS[item.cadence].zh} ${hour}:00`;
}

export function AdminAiManager({
  styles,
  initialBatches
}: {
  styles: ContentStyleOption[];
  initialBatches: AdminAiBatchView[];
}) {
  const [request, setRequest] = useState(EXAMPLE);
  const [scope, setScope] = useState<PlannedTask["scope"]>("all");
  const [depth, setDepth] = useState<PlannedTask["depth"]>("long");
  const [articleCount, setArticleCount] = useState(1);
  const [contentStyleId, setContentStyleId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [planning, setPlanning] = useState(false);
  const [revising, setRevising] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [executed, setExecuted] = useState<ExecuteResult | null>(null);
  const [batches, setBatches] = useState<AdminAiBatchView[]>(initialBatches);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState("");
  // 顶部批次条里当前展开明细的批次(一次一个,点卡片切换)
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  const planRef = useRef<HTMLElement | null>(null);
  const batchesRef = useRef<HTMLElement | null>(null);
  const draftRestoredRef = useRef(false);

  // 挂载时先尝试恢复上次未确认的草案(仅一次)。
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<AiDraft>;
        if (draft.plan) {
          /* eslint-disable react-hooks/set-state-in-effect --
             sessionStorage 草案只能在客户端挂载后恢复：放进 useState 初始化器
             会让 SSR 首帧与客户端首帧不一致（水合报错）。一次性的挂载恢复是
             该规则的已知合法例外。 */
          setRequest(draft.request ?? EXAMPLE);
          setScope(draft.scope ?? "all");
          setDepth(draft.depth ?? "long");
          setArticleCount(draft.articleCount ?? 1);
          setContentStyleId(draft.contentStyleId ?? "");
          setFeedback(draft.feedback ?? "");
          setPlan(draft.plan);
          /* eslint-enable react-hooks/set-state-in-effect */
        }
      }
    } catch {
      // sessionStorage 不可用或草案数据损坏,忽略,按默认态启动
    } finally {
      draftRestoredRef.current = true;
    }
  }, []);

  // 有草案时持续镜像进 sessionStorage;草案清空(取消/执行完成)时清掉暂存。
  // 用 ref 挡住挂载首轮 —— 否则会在恢复生效前用初始默认值把刚读到的草案覆盖掉。
  useEffect(() => {
    if (!draftRestoredRef.current) return;
    try {
      if (plan) {
        const draft: AiDraft = { request, scope, depth, articleCount, contentStyleId, feedback, plan };
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } else {
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // 存储配额已满等情况,放弃暂存,不影响正常使用
    }
  }, [request, scope, depth, articleCount, contentStyleId, feedback, plan]);

  // 结果不在视口内时(计划在表单下方/批次条在页顶),出结果后滚过去,避免用户以为没反应。
  // 执行后计划面板卸载会让页面高度骤变,平滑滚动会被打断,这种场景用瞬时定位。
  function revealPanel(ref: RefObject<HTMLElement | null>, behavior: ScrollBehavior = "smooth") {
    window.setTimeout(() => {
      ref.current?.scrollIntoView({ behavior, block: "start" });
    }, 120);
  }

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const topic of plan?.topics || []) map.set(topic.id, topic.name);
    for (const style of plan?.styles || []) map.set(style.id, style.name);
    for (const style of styles) map.set(style.id, style.name);
    return map;
  }, [plan, styles]);

  const plannedTotal = useMemo(
    () => (plan ? plan.tasks.reduce((sum, task) => sum + task.articleCount, 0) : 0),
    [plan]
  );

  const expandedBatch = expandedBatchId
    ? batches.find((batch) => batch.id === expandedBatchId) || null
    : null;

  async function callApi(payload: Record<string, unknown>) {
    const response = await fetch("/api/admin/ai-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error || "AI 管理员执行失败");
    return data;
  }

  const refreshBatches = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/admin/ai-admin", { method: "GET" });
      if (!response.ok) return;
      const data = (await response.json()) as { batches: AdminAiBatchView[] };
      setBatches(data.batches);
    } catch {
      // 轮询失败静默,下一轮再试
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  // 有排队/运行中的任务时轻量轮询,批次全部完成后自动停。页面隐藏时暂停，
  // 回到页面立即刷新，既能及时看到进度，也不在后台标签页空耗请求。
  const hasActiveJobs = batches.some((batch) =>
    batch.jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING")
  );
  useEffect(() => {
    if (!hasActiveJobs) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshBatches(true);
    };
    const timer = window.setInterval(refreshWhenVisible, 5_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [hasActiveJobs, refreshBatches]);

  async function generatePlan() {
    setPlanning(true);
    setError("");
    setExecuted(null);
    try {
      const data = await callApi({ action: "plan", request, scope, depth, articleCount });
      setPlan(data as unknown as PlanResult);
      setFeedback("");
      revealPanel(planRef);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanning(false);
    }
  }

  async function revisePlan() {
    if (!plan || feedback.trim().length < 2) return;
    setRevising(true);
    setError("");
    try {
      const data = await callApi({
        action: "revise",
        request,
        feedback,
        scope,
        depth,
        articleCount,
        tasks: plan.tasks,
        recurring: plan.recurring
      });
      setPlan(data as unknown as PlanResult);
      setFeedback("");
      revealPanel(planRef);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevising(false);
    }
  }

  async function executePlan() {
    if (!plan || (!plan.tasks.length && !plan.recurring.length)) return;
    setExecuting(true);
    setError("");
    try {
      const data = await callApi({
        action: "execute",
        request,
        scope,
        depth,
        articleCount,
        contentStyleId,
        tasks: plan.tasks,
        recurring: plan.recurring
      });
      const result = data as unknown as ExecuteResult;
      setExecuted(result);
      setPlan(null);
      await refreshBatches();
      setExpandedBatchId(result.batchId);
      revealPanel(batchesRef, "auto");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }

  async function retryJob(jobId: string) {
    setRetryingJobId(jobId);
    setError("");
    try {
      const response = await fetch("/api/admin/ai-admin/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "重试失败");
      await refreshBatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryingJobId("");
    }
  }

  function removeTask(index: number) {
    setPlan((current) =>
      current ? { ...current, tasks: current.tasks.filter((_, i) => i !== index) } : current
    );
  }

  function removeRecurring(index: number) {
    setPlan((current) =>
      current ? { ...current, recurring: current.recurring.filter((_, i) => i !== index) } : current
    );
  }

  const busy = planning || revising || executing;

  return (
    <div className="admin-ai-page">
      {batches.length ? (
        <section className="admin-panel admin-ai-result admin-ai-batches" ref={batchesRef} aria-live="polite">
          <div className="admin-ai-batches-head">
            <h2><I18nText zh="执行批次" en="Batches" /></h2>
            <div className="row-actions">
              <button className="text-link" type="button" disabled={refreshing} onClick={() => void refreshBatches()}>
                {refreshing ? <I18nText zh="刷新中…" en="Refreshing..." /> : <I18nText zh="刷新" en="Refresh" />}
              </button>
              <Link className="text-link" href="/admin/jobs"><I18nText zh="全部任务" en="All jobs" /></Link>
            </div>
          </div>
          {executed ? (
            <p className="muted">
              <I18nText
                zh={`已入队 ${executed.tasks.length} 个任务（${executed.totalArticles} 篇）${executed.recurring.length ? `，创建 ${executed.recurring.filter((r) => r.created).length} 个周期主题` : ""}。`}
                en={`Queued ${executed.tasks.length} tasks (${executed.totalArticles} articles)${executed.recurring.length ? `, created ${executed.recurring.filter((r) => r.created).length} recurring topics` : ""}.`}
              />
              {executed.warnings.length ? ` ${executed.warnings.join("；")}` : null}
            </p>
          ) : null}
          <div className="admin-ai-batch-strip">
            {batches.map((batch) => {
              const progress = getBatchProgress(batch.jobs.map((job) => job.status));
              const done = batch.jobs.filter((job) => job.status === "COMPLETED").length;
              const failed = batch.jobs.filter((job) => job.status === "FAILED").length;
              const running = batch.jobs.filter((job) => job.status === "RUNNING").length;
              const queued = batch.jobs.filter((job) => job.status === "QUEUED").length;
              const active = batch.jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING");
              const batchStatus: JobStatus = active ? "RUNNING" : failed ? "FAILED" : "COMPLETED";
              const expanded = expandedBatchId === batch.id;
              return (
                <button
                  key={batch.id}
                  type="button"
                  className={`admin-ai-batch-card${expanded ? " is-expanded" : ""}`}
                  aria-expanded={expanded}
                  onClick={() => setExpandedBatchId(expanded ? null : batch.id)}
                >
                  <span className="admin-ai-batch-summary">{batch.summary}</span>
                  <span className="muted admin-ai-batch-meta">{new Date(batch.createdAt).toLocaleString()}</span>
                  <TaskProgress
                    compact
                    label={`批次进度 ${progress.settled}/${progress.total}`}
                    value={progress.settled}
                    max={Math.max(progress.total, 1)}
                  />
                  <span className="meta-row">
                    <StatusPill status={batchStatus} />
                    <span className="muted">
                      <I18nText
                        zh={`完成 ${done}/${batch.jobs.length}${running ? `，运行 ${running}` : ""}${queued ? `，排队 ${queued}` : ""}${failed ? `，失败 ${failed}` : ""}`}
                        en={`${done}/${batch.jobs.length} done${running ? `, ${running} running` : ""}${queued ? `, ${queued} queued` : ""}${failed ? `, ${failed} failed` : ""}`}
                      />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {expandedBatch ? (
            <div className="admin-ai-batch-detail">
              {(() => {
                const progress = getBatchProgress(expandedBatch.jobs.map((job) => job.status));
                return (
                  <TaskProgress
                    label={`批次进度：已结束 ${progress.settled}/${progress.total} 个任务`}
                    stage={expandedBatch.jobs.some((job) => job.status === "RUNNING")
                      ? "正在采集资料并生成文章"
                      : expandedBatch.jobs.some((job) => job.status === "QUEUED")
                        ? "等待任务开始"
                        : "批次已结束"}
                    value={progress.settled}
                    max={Math.max(progress.total, 1)}
                  />
                );
              })()}
              <p className="muted admin-ai-batch-request">{expandedBatch.request}</p>
              {expandedBatch.jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING") ? (
                <p className="muted admin-ai-batch-request">
                  <I18nText
                    zh="研究任务按安全并发逐项执行；复杂网页抓取和模型推理可能持续数分钟。仍显示“运行中”或“排队中”即未停止。"
                    en="Research tasks run at a safe concurrency. Complex page collection and model reasoning can take several minutes; Running or Queued means the batch has not stopped."
                  />
                </p>
              ) : null}
              <ul className="admin-ai-batch-jobs">
                {expandedBatch.jobs.map((job, index) => (
                  <li key={job.id}>
                    <StatusPill status={job.status} />
                    <a className="text-link" href={`/admin/jobs/${job.id}`}>{job.keyword}</a>
                    {job.status === "RUNNING" ? (
                      <span className="muted">
                        <I18nText
                          zh={`第 ${index + 1}/${expandedBatch.jobs.length} 项 · ${job.keyword.startsWith("文章返修：") ? "正在按审核意见返修并复检" : "正在采集、成稿并执行最多 3 轮自动返修"} · 最近活动 ${new Date(job.updatedAt).toLocaleTimeString()}`}
                          en={`Item ${index + 1}/${expandedBatch.jobs.length} · ${job.keyword.startsWith("文章返修：") ? "Repairing against publication feedback" : "Collecting, drafting, and running up to 3 repair rounds"} · Last active ${new Date(job.updatedAt).toLocaleTimeString()}`}
                        />
                      </span>
                    ) : job.status === "QUEUED" ? (
                      <span className="muted"><I18nText zh="等待前序任务" en="Waiting for earlier tasks" /></span>
                    ) : null}
                    {job.status === "FAILED" ? (
                      <button
                        className="text-link"
                        type="button"
                        disabled={retryingJobId === job.id}
                        onClick={() => void retryJob(job.id)}
                      >
                        {retryingJobId === job.id
                          ? <I18nText zh="重试中…" en="Retrying..." />
                          : <I18nText zh="重试" en="Retry" />}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {expandedBatch.recurring.length ? (
                <div className="meta-row">
                  {expandedBatch.recurring.map((item) => (
                    <span className="tag" key={item.name}>
                      {item.name} · <I18nText zh={item.cadence.zh} en={item.cadence.en} />
                    </span>
                  ))}
                  <a className="text-link" href="/admin/auto-curation">
                    <I18nText zh="管理自动内容" en="Manage auto content" />
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="admin-ai-main">
        <section className="admin-panel admin-ai-command">
          <div>
            <p className="eyebrow">AI Admin</p>
            <h2><I18nText zh="把需求交给 AI 管理员" en="Delegate a content task" /></h2>
            <p className="muted">
              <I18nText
                zh="用自然语言描述想要的内容（明确篇数、模糊数量、周期性需求都可以）。AI 管理员先给出拆解计划，可以继续用修改意见调整，确认后才会执行；草稿仍需审核后发布。"
                en="Describe what you want in natural language — exact counts, vague quantities, or recurring needs. The AI admin proposes a plan you can refine with feedback; nothing runs until you confirm. Drafts still require review."
              />
            </p>
          </div>

          <div className="field">
            <label htmlFor="admin-ai-request"><I18nText zh="任务需求" en="Task request" /></label>
            <textarea
              id="admin-ai-request"
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              rows={8}
              maxLength={6000}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="admin-ai-scope"><I18nText zh="默认搜索范围" en="Default scope" /></label>
              <select id="admin-ai-scope" value={scope} onChange={(event) => setScope(event.target.value as PlannedTask["scope"])}>
                <option value="all">国内 + 国外 / All</option>
                <option value="domestic">国内来源 / Domestic</option>
                <option value="international">国外来源 / International</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="admin-ai-depth"><I18nText zh="默认文章长度" en="Default length" /></label>
              <select id="admin-ai-depth" value={depth} onChange={(event) => setDepth(event.target.value as PlannedTask["depth"])}>
                <option value="standard">标准 / Standard</option>
                <option value="long">长文 / Long</option>
                <option value="deep">深度长文 / In-depth</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="admin-ai-count"><I18nText zh="每个选题默认篇数" en="Default articles per topic" /></label>
              <input
                id="admin-ai-count"
                type="number"
                min="1"
                max="5"
                value={articleCount}
                onChange={(event) => setArticleCount(Number(event.target.value) || 1)}
              />
            </div>
            <div className="field">
              <label htmlFor="admin-ai-style"><I18nText zh="默认生成风格" en="Default style" /></label>
              <select id="admin-ai-style" value={contentStyleId} onChange={(event) => setContentStyleId(event.target.value)}>
                <option value="">使用默认风格 / Default style</option>
                {styles.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.name}{style.isDefault ? "（默认 / default）" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {planning ? (
            <TaskProgress
              label="正在生成任务计划"
              stage="AI 正在理解需求并拆分可执行任务"
              active
            />
          ) : null}

          <button
            className="button admin-ai-submit"
            type="button"
            disabled={busy || request.trim().length < 4}
            onClick={generatePlan}
          >
            {planning
              ? <I18nText zh="AI 正在思考拆解…" en="Planning..." />
              : plan
                ? <I18nText zh="重新规划" en="Re-plan" />
                : <I18nText zh="生成计划" en="Generate plan" />}
          </button>
        </section>

        {plan ? (
          <section className="admin-panel admin-ai-result" ref={planRef} aria-live="polite">
            <h2><I18nText zh="拆解计划（待确认）" en="Proposed Plan" /></h2>
            <p className="muted">{plan.summary}</p>
            <p className="muted">
              <I18nText
                zh={`${plan.tasks.length} 个一次性任务（${plannedTotal} 篇）${plan.recurring.length ? ` + ${plan.recurring.length} 个周期任务` : ""}。不需要的可以移除。`}
                en={`${plan.tasks.length} one-off tasks (${plannedTotal} articles)${plan.recurring.length ? ` + ${plan.recurring.length} recurring` : ""}. Remove any you do not want.`}
              />
            </p>
            {plan.warnings.length ? (
              <div className="admin-ai-warning">
                <strong><I18nText zh="需要确认" en="Needs review" /></strong>
                <ul>
                  {plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="admin-ai-task-list">
              {plan.tasks.map((task, index) => (
                <article className="admin-ai-task" key={`${task.keyword}-${index}`}>
                  <strong>{task.keyword}</strong>
                  <p>{task.reason}</p>
                  <div className="meta-row">
                    <span className="tag">{task.scope}</span>
                    <span className="tag">{task.depth}</span>
                    <span className="tag">{task.articleCount} 篇</span>
                    {task.topicId ? (
                      <span className="tag">{nameById.get(task.topicId) || task.topicId}</span>
                    ) : (
                      <span className="tag"><I18nText zh="自动归类" en="Auto topic" /></span>
                    )}
                    {task.styleId ? <span className="tag">{nameById.get(task.styleId) || task.styleId}</span> : null}
                    <button className="text-link" type="button" onClick={() => removeTask(index)}>
                      <I18nText zh="移除" en="Remove" />
                    </button>
                  </div>
                </article>
              ))}
              {plan.recurring.map((item, index) => (
                <article className="admin-ai-task admin-ai-recurring" key={`recurring-${item.name}-${index}`}>
                  <strong>{item.name}</strong>
                  <p>{item.reason || item.keywords}</p>
                  <div className="meta-row">
                    <span className="tag">{cadenceText(item)}</span>
                    <span className="tag">{MODE_LABELS[item.mode].zh}</span>
                    <span className="tag">{item.scope}</span>
                    <span className="tag">{item.articleCount} 篇/次</span>
                    {item.styleId ? <span className="tag">{nameById.get(item.styleId) || item.styleId}</span> : null}
                    <button className="text-link" type="button" onClick={() => removeRecurring(index)}>
                      <I18nText zh="移除" en="Remove" />
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="field">
              <label htmlFor="admin-ai-feedback"><I18nText zh="修改意见（可选）" en="Revision feedback (optional)" /></label>
              <textarea
                id="admin-ai-feedback"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="例：日本那篇改成讲日元贬值；AI 进步的减到 2 篇。"
              />
            </div>
            {revising || executing ? (
              <TaskProgress
                label={revising ? "正在修订任务计划" : "正在创建并派发任务"}
                stage={revising ? "AI 正在按你的意见重新拆解" : "正在保存批次并加入执行队列"}
                active
              />
            ) : null}
            <div className="row-actions">
              <button
                className="button secondary"
                type="button"
                disabled={busy || feedback.trim().length < 2}
                onClick={revisePlan}
              >
                {revising ? <I18nText zh="正在修订…" en="Revising..." /> : <I18nText zh="按意见修订计划" en="Revise plan" />}
              </button>
              <button
                className="button admin-ai-submit"
                type="button"
                disabled={busy || (!plan.tasks.length && !plan.recurring.length)}
                onClick={executePlan}
              >
                {executing
                  ? <I18nText zh="正在执行…" en="Running..." />
                  : <I18nText
                      zh={`确认执行（${plan.tasks.length} 任务${plan.recurring.length ? ` + ${plan.recurring.length} 周期` : ""}）`}
                      en={`Confirm & run (${plan.tasks.length} tasks${plan.recurring.length ? ` + ${plan.recurring.length} recurring` : ""})`}
                    />}
              </button>
            </div>
          </section>
        ) : null}

      </div>

    </div>
  );
}
