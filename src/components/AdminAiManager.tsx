"use client";

import { useMemo, useState } from "react";
import { I18nText } from "./I18nText";

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
};

type QueuedTask = PlannedTask & { jobId: string };

type PlanResult = {
  summary: string;
  warnings: string[];
  tasks: PlannedTask[];
  totalArticles: number;
  topics: Array<{ id: string; name: string }>;
};

type ExecuteResult = {
  executed: true;
  tasks: QueuedTask[];
  totalArticles: number;
  warnings: string[];
};

const EXAMPLE =
  "生成 4 篇财经博客（其中 1 篇与日本有关，其他与欧洲相关），再来 8 篇 AI 主题博客（几篇讲 AI 的最新进步，几篇分析欧洲 AI 发展迟缓的原因）。";

export function AdminAiManager({ styles }: { styles: ContentStyleOption[] }) {
  const [request, setRequest] = useState(EXAMPLE);
  const [scope, setScope] = useState<PlannedTask["scope"]>("all");
  const [depth, setDepth] = useState<PlannedTask["depth"]>("long");
  const [articleCount, setArticleCount] = useState(1);
  const [contentStyleId, setContentStyleId] = useState("");
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [executed, setExecuted] = useState<ExecuteResult | null>(null);

  const topicNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const topic of plan?.topics || []) map.set(topic.id, topic.name);
    return map;
  }, [plan]);

  const plannedTotal = useMemo(
    () => (plan ? plan.tasks.reduce((sum, task) => sum + task.articleCount, 0) : 0),
    [plan]
  );

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

  async function generatePlan() {
    setPlanning(true);
    setError("");
    setExecuted(null);
    try {
      const data = await callApi({ action: "plan", request, scope, depth, articleCount });
      setPlan(data as unknown as PlanResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanning(false);
    }
  }

  async function executePlan() {
    if (!plan?.tasks.length) return;
    setExecuting(true);
    setError("");
    try {
      const data = await callApi({
        action: "execute",
        scope,
        depth,
        articleCount,
        contentStyleId,
        tasks: plan.tasks
      });
      setExecuted(data as unknown as ExecuteResult);
      setPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }

  function removeTask(index: number) {
    setPlan((current) =>
      current ? { ...current, tasks: current.tasks.filter((_, i) => i !== index) } : current
    );
  }

  const busy = planning || executing;

  return (
    <div className="admin-ai-layout">
      <section className="admin-panel admin-ai-command">
        <div>
          <p className="eyebrow">AI Admin</p>
          <h2><I18nText zh="把需求交给 AI 管理员" en="Delegate a content task" /></h2>
          <p className="muted">
            <I18nText
              zh="用自然语言描述想要的内容（明确篇数或模糊数量都可以）。AI 管理员先给出拆解计划，你确认后才会入队生成草稿；草稿仍需审核后发布。"
              en="Describe the content you want in natural language — exact counts or vague quantities both work. The AI admin proposes a plan first; nothing is queued until you confirm. Drafts still require review."
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
            <label htmlFor="admin-ai-style"><I18nText zh="生成风格" en="Content style" /></label>
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

      <aside className="admin-ai-side">
        <section className="admin-panel">
          <h2><I18nText zh="执行边界" en="Execution Rules" /></h2>
          <ul className="admin-ai-rules">
            <li><I18nText zh="先出计划，确认后才入队；不直接发布文章。" en="Plans first, queues only after you confirm; never publishes directly." /></li>
            <li><I18nText zh="复用现有联网搜索与草稿生成流程，并把任务挂到对应主题分类。" en="Uses the existing research pipeline and binds tasks to site topics." /></li>
            <li><I18nText zh="生成结果进入任务诊断与文章草稿，便于审核。" en="Results appear in jobs and drafts for review." /></li>
          </ul>
        </section>

        {plan ? (
          <section className="admin-panel admin-ai-result" aria-live="polite">
            <h2><I18nText zh="拆解计划（待确认）" en="Proposed Plan" /></h2>
            <p className="muted">{plan.summary}</p>
            <p className="muted">
              <I18nText
                zh={`共 ${plan.tasks.length} 个任务、${plannedTotal} 篇文章。不需要的任务可以移除。`}
                en={`${plan.tasks.length} tasks, ${plannedTotal} articles. Remove any task you do not want.`}
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
                      <span className="tag">{topicNames.get(task.topicId) || task.topicId}</span>
                    ) : (
                      <span className="tag"><I18nText zh="自动归类" en="Auto topic" /></span>
                    )}
                    <button className="text-link" type="button" onClick={() => removeTask(index)}>
                      <I18nText zh="移除" en="Remove" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <button
              className="button admin-ai-submit"
              type="button"
              disabled={busy || !plan.tasks.length}
              onClick={executePlan}
            >
              {executing
                ? <I18nText zh="正在入队…" en="Queuing..." />
                : <I18nText
                    zh={`确认执行（${plan.tasks.length} 个任务 / ${plannedTotal} 篇）`}
                    en={`Confirm & run (${plan.tasks.length} tasks / ${plannedTotal} articles)`}
                  />}
            </button>
          </section>
        ) : null}

        {executed ? (
          <section className="admin-panel admin-ai-result" aria-live="polite">
            <h2><I18nText zh="已创建任务" en="Queued Tasks" /></h2>
            <p className="muted">
              <I18nText
                zh={`已入队 ${executed.tasks.length} 个任务、共 ${executed.totalArticles} 篇文章，完成后出现在文章草稿中。`}
                en={`Queued ${executed.tasks.length} tasks (${executed.totalArticles} articles). Drafts will appear under Posts when done.`}
              />
            </p>
            <div className="admin-ai-task-list">
              {executed.tasks.map((task) => (
                <article className="admin-ai-task" key={task.jobId}>
                  <strong>{task.keyword}</strong>
                  <p>{task.reason}</p>
                  <div className="meta-row">
                    <span className="tag">{task.scope}</span>
                    <span className="tag">{task.depth}</span>
                    <span className="tag">{task.articleCount} 篇</span>
                    <a className="text-link" href={`/admin/jobs/${task.jobId}`}>
                      <I18nText zh="查看任务" en="Open job" />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
