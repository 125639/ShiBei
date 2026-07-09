"use client";

import { useState } from "react";
import { I18nText } from "./I18nText";

type ContentStyleOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

type AiTask = {
  keyword: string;
  reason: string;
  scope: "all" | "domestic" | "international";
  depth: "standard" | "long" | "deep";
  articleCount: number;
  jobId: string;
};

type AiResult = {
  summary: string;
  warnings: string[];
  tasks: AiTask[];
};

const EXAMPLE = "请帮我规划并创建 4 篇草稿：两篇关于 AI 智能体在企业中的落地，两篇关于可持续发展和绿色技术，要求资料来源可靠、角度不要重复。";

export function AdminAiManager({ styles }: { styles: ContentStyleOption[] }) {
  const [request, setRequest] = useState(EXAMPLE);
  const [scope, setScope] = useState<AiTask["scope"]>("all");
  const [depth, setDepth] = useState<AiTask["depth"]>("long");
  const [articleCount, setArticleCount] = useState(1);
  const [contentStyleId, setContentStyleId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiResult | null>(null);

  async function submit() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/admin/ai-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, scope, depth, articleCount, contentStyleId })
      });
      const data = (await response.json().catch(() => ({}))) as AiResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "AI 管理员执行失败");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-ai-layout">
      <section className="admin-panel admin-ai-command">
        <div>
          <p className="eyebrow">AI Admin</p>
          <h2><I18nText zh="把需求交给 AI 管理员" en="Delegate a content task" /></h2>
          <p className="muted">
            <I18nText
              zh="AI 管理员会把自然语言需求拆成多个关键词研究任务，进入现有队列生成草稿。草稿仍需管理员审核后发布。"
              en="The AI admin turns natural-language requests into queued keyword research jobs. Drafts still require admin review before publishing."
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
            <select id="admin-ai-scope" value={scope} onChange={(event) => setScope(event.target.value as AiTask["scope"])}>
              <option value="all">国内 + 国外 / All</option>
              <option value="domestic">国内来源 / Domestic</option>
              <option value="international">国外来源 / International</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="admin-ai-depth"><I18nText zh="默认文章长度" en="Default length" /></label>
            <select id="admin-ai-depth" value={depth} onChange={(event) => setDepth(event.target.value as AiTask["depth"])}>
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

        <button className="button admin-ai-submit" type="button" disabled={loading || request.trim().length < 4} onClick={submit}>
          {loading ? <I18nText zh="正在规划并创建任务…" en="Planning and queuing..." /> : <I18nText zh="让 AI 管理员执行" en="Run AI Admin" />}
        </button>
      </section>

      <aside className="admin-ai-side">
        <section className="admin-panel">
          <h2><I18nText zh="执行边界" en="Execution Rules" /></h2>
          <ul className="admin-ai-rules">
            <li><I18nText zh="只创建内容研究任务，不直接发布文章。" en="Creates research jobs only; it never publishes directly." /></li>
            <li><I18nText zh="复用现有联网搜索与草稿生成流程。" en="Uses the existing web research and draft pipeline." /></li>
            <li><I18nText zh="生成结果进入任务诊断与文章草稿，便于审核。" en="Results appear in jobs and drafts for review." /></li>
          </ul>
        </section>

        {result ? (
          <section className="admin-panel admin-ai-result" aria-live="polite">
            <h2><I18nText zh="已创建任务" en="Queued Tasks" /></h2>
            <p className="muted">{result.summary}</p>
            {result.warnings.length ? (
              <div className="admin-ai-warning">
                <strong><I18nText zh="需要确认" en="Needs review" /></strong>
                <ul>
                  {result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="admin-ai-task-list">
              {result.tasks.map((task) => (
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
