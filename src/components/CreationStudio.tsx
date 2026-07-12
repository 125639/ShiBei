"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { markdownToHtml } from "@/lib/markdown";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

type Dimension = { key: string; label: string; weight: number; hint: string };

type Genre = {
  id: string;
  slug: string;
  name: string;
  description: string;
  dimensions: Dimension[];
  threshold: number;
};

type DepthKey = "SHORT" | "FULL";
type ModeKey = "VOICE_FIRST" | "AI_FIRST";

type DepthMeta = { minQuestions: number; maxQuestions: number; label: string; description: string };
type ModeMeta = { label: string; description: string };

type InterviewEntry = { question: string; answer: string };

type ScoreDetail = {
  dimensions: Array<{ key: string; label: string; weight: number; score: number; feedback: string }>;
  total: number;
  threshold: number;
  publishable: boolean;
  overallComment: string;
  suggestions: string[];
};

type Work = {
  id: string;
  slug: string | null;
  status: "INTERVIEWING" | "DRAFT" | "SHARED";
  mode: ModeKey;
  depth: DepthKey;
  topic: string;
  title: string;
  summary: string;
  content: string;
  interview: InterviewEntry[];
  pendingQuestion: string | null;
  minQuestions: number;
  maxQuestions: number;
  genre: Genre;
  isAnonymous: boolean;
  score: number | null;
  scoreDetail: ScoreDetail | null;
  publishedAt: string | null;
};

type WorkListItem = {
  id: string;
  slug: string | null;
  status: Work["status"];
  topic: string;
  title: string;
  score: number | null;
  updatedAt: string;
  genre: { name: string; threshold: number };
};

const STATUS_LABELS: Record<Work["status"], string> = {
  INTERVIEWING: "访谈中",
  DRAFT: "草稿",
  SHARED: "已公开"
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `请求失败（${response.status}）`);
  return data as T;
}

export function CreationStudio() {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [depths, setDepths] = useState<Record<DepthKey, DepthMeta> | null>(null);
  const [modes, setModes] = useState<Record<ModeKey, ModeMeta> | null>(null);
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [quotaLimit, setQuotaLimit] = useState(2);
  const [loadError, setLoadError] = useState("");

  const [work, setWork] = useState<Work | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // 第一步：题材（=评分标尺）、模式、深度、主题
  const [genreId, setGenreId] = useState("");
  const [mode, setMode] = useState<ModeKey>("VOICE_FIRST");
  const [depth, setDepth] = useState<DepthKey>("SHORT");
  const [topic, setTopic] = useState("");

  // 访谈回答
  const [answer, setAnswer] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // 草稿编辑（本地副本，保存时 PATCH）
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editContent, setEditContent] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [touchedAfterScore, setTouchedAfterScore] = useState(false);
  const [confirmAnonPublish, setConfirmAnonPublish] = useState(false);
  const [showAnonConfirm, setShowAnonConfirm] = useState(false);
  // 成稿审校提示（归因/事实/歧义）：只在刚生成后展示，切换作品或重新访谈即清空
  const [composeNotes, setComposeNotes] = useState<string[]>([]);

  const refreshWorks = useCallback(async () => {
    const data = await requestJson<{
      works: WorkListItem[];
      isMember: boolean;
      anonQuotaRemaining: number | null;
      anonWorkLimit: number;
    }>("/api/public/creation/works");
    setWorks(data.works);
    setIsMember(data.isMember);
    setQuotaRemaining(data.anonQuotaRemaining);
    setQuotaLimit(data.anonWorkLimit);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [genreData] = await Promise.all([
          requestJson<{ genres: Genre[]; depths: Record<DepthKey, DepthMeta>; modes: Record<ModeKey, ModeMeta> }>(
            "/api/public/creation/genres"
          ),
          refreshWorks()
        ]);
        setGenres(genreData.genres);
        setDepths(genreData.depths);
        setModes(genreData.modes);
        if (genreData.genres.length > 0) setGenreId(genreData.genres[0].id);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [refreshWorks]);

  useEffect(() => {
    if (work?.status === "DRAFT") {
      setEditTitle(work.title);
      setEditSummary(work.summary);
      setEditContent(work.content);
    }
  }, [work?.id, work?.status, work?.title, work?.summary, work?.content]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [work?.interview.length, work?.pendingQuestion]);

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const startInterview = () =>
    run("start", async () => {
      const data = await requestJson<{ work: Work }>("/api/public/creation/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genreId, mode, depth, topic })
      });
      setWork(data.work);
      setTouchedAfterScore(false);
      setComposeNotes([]);
      await refreshWorks();
    });

  const submitAnswer = () =>
    run("answer", async () => {
      if (!work) return;
      const data = await requestJson<{ done: boolean; work: Work }>(
        `/api/public/creation/works/${work.id}/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer })
        }
      );
      setWork(data.work);
      setAnswer("");
    });

  const composeDraft = () =>
    run("compose", async () => {
      if (!work) return;
      const response = await fetch(`/api/public/creation/works/${work.id}/compose`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as {
        work?: Work;
        composeNotes?: string[];
        error?: string;
      };
      if (!response.ok) {
        if (data.work) {
          setWork(data.work);
          setComposeNotes(Array.isArray(data.composeNotes) ? data.composeNotes : []);
        }
        throw new Error(data.error || `请求失败（${response.status}）`);
      }
      if (!data.work) throw new Error("成稿接口没有返回作品数据");
      setWork(data.work);
      setComposeNotes(Array.isArray(data.composeNotes) ? data.composeNotes : []);
      setTouchedAfterScore(false);
      setShowPreview(false);
      await refreshWorks();
    });

  const saveDraft = () =>
    run("save", async () => {
      if (!work) return;
      const data = await requestJson<{ work: Work }>(`/api/public/creation/works/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, summary: editSummary, content: editContent })
      });
      if (work.score !== null && editContent !== work.content) setTouchedAfterScore(true);
      setWork(data.work);
    });

  const scoreDraft = () =>
    run("score", async () => {
      if (!work) return;
      if (isDirty) {
        const saved = await requestJson<{ work: Work }>(`/api/public/creation/works/${work.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: editTitle, summary: editSummary, content: editContent })
        });
        setWork(saved.work);
      }
      const data = await requestJson<{ work: Work }>(`/api/public/creation/works/${work.id}/score`, {
        method: "POST"
      });
      setWork(data.work);
      setTouchedAfterScore(false);
    });

  const publishWork = (confirmed: boolean) =>
    run("publish", async () => {
      if (!work) return;
      const data = await requestJson<{ work: Work; url: string }>(
        `/api/public/creation/works/${work.id}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmAnonymousNoDelete: confirmed })
        }
      );
      setWork(data.work);
      setShowAnonConfirm(false);
      await refreshWorks();
    });

  const resumeWork = (id: string) =>
    run("resume", async () => {
      const data = await requestJson<{ work: Work }>(`/api/public/creation/works/${id}`);
      setWork(data.work);
      setComposeNotes([]);
      setTouchedAfterScore(false);
      setShowAnonConfirm(false);
    });

  const selectedGenre = genres.find((item) => item.id === genreId) || null;
  const isDirty = Boolean(
    work?.status === "DRAFT" &&
    (editTitle !== work.title || editSummary !== work.summary || editContent !== work.content)
  );
  // 草稿有未保存修改时，拦住误关标签页/刷新（访谈答案与站内「返回列表」另有确认）。
  useUnsavedChangesGuard(isDirty);
  const interviewFinished = Boolean(work && work.status === "INTERVIEWING" && !work.pendingQuestion);
  const canFinishEarly = Boolean(
    work && work.status === "INTERVIEWING" && work.pendingQuestion && work.interview.length >= work.minQuestions
  );

  if (loadError) {
    return (
      <section className="form-card form-stack">
        <p className="muted-block creation-error" role="alert">加载失败：{loadError}</p>
        <button className="button secondary" type="button" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </section>
    );
  }

  // ============ 第一步：选题材（同时定评分标尺）+ 模式 + 深度 ============
  if (!work) {
    return (
      <div className="creation-studio">
        <section className="form-card form-stack">
          <h2>开始一次共创</h2>
          <p className="muted-block">
            你的内容默认私有：访谈与草稿只有你自己可见，在你主动点击发布之前，绝不会公开。
            {!isMember && quotaRemaining !== null ? (
              <>
                {" "}未登录状态下单个 IP 最多生成 {quotaLimit} 篇（还剩 {quotaRemaining} 篇），且发布后不可删除；
                <Link className="text-link" href="/account">使用邀请码注册账号</Link>后不受此限并可随时删除、导出自己的作品。
              </>
            ) : null}
          </p>

          <fieldset className="field creation-choice-field">
            <legend>1. 选择题材——同时确定这篇文章的评分标尺</legend>
            <div className="creation-genre-grid">
              {genres.map((genre) => (
                <button
                  key={genre.id}
                  type="button"
                  aria-pressed={genre.id === genreId}
                  className={`creation-genre-card${genre.id === genreId ? " selected" : ""}`}
                  onClick={() => setGenreId(genre.id)}
                >
                  <strong>{genre.name}</strong>
                  <span className="muted">{genre.description}</span>
                  <span className="creation-rubric">
                    {genre.dimensions.map((dim) => (
                      <span key={dim.key} className="tag" title={dim.hint}>
                        {dim.label} {Math.round(dim.weight * 100)}%
                      </span>
                    ))}
                  </span>
                  <span className="muted">公开门槛：加权总分 ≥ {genre.threshold}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {modes ? (
            <fieldset className="field creation-choice-field">
              <legend>2. 成文模式</legend>
              <div className="creation-option-row">
                {(Object.keys(modes) as ModeKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={mode === key}
                    className={`creation-option-card${mode === key ? " selected" : ""}`}
                    onClick={() => setMode(key)}
                  >
                    <strong>{modes[key].label}</strong>
                    <span className="muted">{modes[key].description}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {depths ? (
            <fieldset className="field creation-choice-field">
              <legend>3. 访谈深度</legend>
              <div className="creation-option-row">
                {(Object.keys(depths) as DepthKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={depth === key}
                    className={`creation-option-card${depth === key ? " selected" : ""}`}
                    onClick={() => setDepth(key)}
                  >
                    <strong>{depths[key].label}</strong>
                    <span className="muted">{depths[key].description}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="field">
            <label htmlFor="creation-topic">4. 用一句话说明你想写什么</label>
            <input
              id="creation-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder={selectedGenre ? `例如：${placeholderForGenre(selectedGenre.slug)}` : ""}
              maxLength={300}
            />
          </div>

          {error ? <p className="muted-block creation-error" role="alert">{error}</p> : null}
          <button
            className="button"
            type="button"
            disabled={busy !== null || !genreId || topic.trim().length < 2}
            onClick={startInterview}
          >
            {busy === "start" ? "AI 正在准备第一个问题…" : "开始访谈"}
          </button>
        </section>

        {works.length > 0 ? (
          <section className="form-card form-stack">
            <h2>我的创作</h2>
            <ul className="creation-work-list">
              {works.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="creation-work-item"
                    onClick={() => resumeWork(item.id)}
                    disabled={busy !== null}
                  >
                    <span className={`tag creation-status-${item.status.toLowerCase()}`}>{STATUS_LABELS[item.status]}</span>
                    <span className="creation-work-title">{item.title || item.topic}</span>
                    <span className="muted">
                      {item.genre.name}
                      {item.score !== null ? ` ｜ ${item.score} 分（门槛 ${item.genre.threshold}）` : ""}
                    </span>
                  </button>
                  {item.status === "SHARED" && item.slug ? (
                    <Link className="text-link" href={`/community/${item.slug}`}>查看</Link>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="muted">
              作品管理（导出 / 删除）在<Link className="text-link" href="/account">账户页</Link>。
            </p>
          </section>
        ) : null}
      </div>
    );
  }

  // ============ 第二步：访谈 ============
  if (work.status === "INTERVIEWING") {
    const total = work.minQuestions === work.maxQuestions ? `${work.minQuestions}` : `${work.minQuestions}-${work.maxQuestions}`;
    return (
      <div className="creation-studio">
        <section className="form-card form-stack">
          <div className="row between">
            <h2>访谈：{work.topic}</h2>
            <span className="tag">{work.genre.name} ｜ 已答 {work.interview.length} / 约 {total} 题</span>
          </div>
          <div className="creation-chat" aria-live="polite">
            {work.interview.map((entry, index) => (
              <div key={index}>
                <div className="creation-bubble creation-bubble-ai">{entry.question}</div>
                <div className="creation-bubble creation-bubble-user">{entry.answer}</div>
              </div>
            ))}
            {work.pendingQuestion ? (
              <div className="creation-bubble creation-bubble-ai creation-bubble-current">{work.pendingQuestion}</div>
            ) : null}
            <div ref={chatEndRef} />
          </div>

          {interviewFinished ? (
            <>
              <p className="muted-block">访谈完成。AI 会先生成一份可编辑的草稿——内容经你过目、修改并主动发布后才会公开。</p>
              {error ? <p className="muted-block creation-error" role="alert">{error}</p> : null}
              <button className="button" type="button" disabled={busy !== null} onClick={composeDraft}>
                {busy === "compose" ? "正在成稿…" : "生成可编辑草稿"}
              </button>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="creation-answer">你的回答（越具体越好：原话、场景、数字、步骤都可以直接用于成文）</label>
                <textarea
                  id="creation-answer"
                  rows={4}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  disabled={busy !== null}
                />
              </div>
              {error ? <p className="muted-block creation-error" role="alert">{error}</p> : null}
              <div className="row-actions">
                <button className="button" type="button" disabled={busy !== null || !answer.trim()} onClick={submitAnswer}>
                  {busy === "answer" ? "AI 正在追问…" : "提交回答"}
                </button>
                {canFinishEarly ? (
                  <button className="button secondary" type="button" disabled={busy !== null} onClick={composeDraft}>
                    {busy === "compose" ? "正在成稿…" : "素材够了，直接成稿"}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    );
  }

  // ============ 第四步（终态）：已公开 ============
  if (work.status === "SHARED") {
    return (
      <div className="creation-studio">
        <section className="form-card form-stack">
          <h2>已公开：{work.title}</h2>
          <p className="muted-block">
            这篇作品已发布到社区{work.isAnonymous ? "。匿名发布的作品不可删除；使用邀请码注册后，新发布的作品可随时删除。" : "，你可以随时在账户页删除它。"}
          </p>
          <div className="row-actions">
            {work.slug ? <Link className="button" href={`/community/${work.slug}`}>查看发布页</Link> : null}
            <a className="button secondary" href={`/api/public/creation/works/${work.id}/export`}>导出 Markdown</a>
            <button className="button secondary" type="button" onClick={() => setWork(null)}>返回列表</button>
          </div>
        </section>
      </div>
    );
  }

  // ============ 第三步：草稿编辑 + 评分 + 发布 ============
  const detail = work.scoreDetail;
  const scoreValid = work.score !== null && !touchedAfterScore && !isDirty;
  return (
    <div className="creation-studio">
      <section className="form-card form-stack">
        <div className="row between">
          <h2>可编辑草稿</h2>
          <span className="tag">{work.genre.name} ｜ 公开门槛 ≥ {work.genre.threshold} 分</span>
        </div>
        <p className="muted-block">
          这是 AI 根据访谈生成的草稿，不会直接存档或公开——内容始终经你本人过目修改，评分达标后由你决定是否发布。
        </p>

        {composeNotes.length > 0 ? (
          <div className="creation-compose-notes" role="status">
            <strong>成稿审校提示</strong>
            <ul>
              {composeNotes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
            <p className="muted">
              标「已修正」的问题草稿里已按访谈原意改写；标「请核实」或「歧义」的地方请对照你的回答逐条确认。
            </p>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="creation-title">标题</label>
          <input id="creation-title" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="creation-summary">摘要</label>
          <textarea id="creation-summary" rows={2} value={editSummary} onChange={(event) => setEditSummary(event.target.value)} />
        </div>
        <div className="field">
          <div className="row between">
            <label htmlFor="creation-content">正文（Markdown）</label>
            <button className="button secondary" type="button" onClick={() => setShowPreview((value) => !value)}>
              {showPreview ? "继续编辑" : "预览"}
            </button>
          </div>
          {showPreview ? (
            <div className="prose creation-preview" dangerouslySetInnerHTML={{ __html: markdownToHtml(editContent) }} />
          ) : (
            <textarea id="creation-content" rows={18} value={editContent} onChange={(event) => setEditContent(event.target.value)} />
          )}
        </div>

        {error ? <p className="muted-block creation-error" role="alert">{error}</p> : null}
        <div className="row-actions">
          <button className="button secondary" type="button" disabled={busy !== null || !isDirty} onClick={saveDraft}>
            {busy === "save" ? "保存中…" : isDirty ? "保存修改" : "已保存"}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={busy !== null}
            onClick={() => {
              // 重新成稿会用 AI 输出覆盖当前草稿；有手动修改时先确认。
              if (isDirty && !window.confirm("重新生成会覆盖当前未保存的修改，确定继续吗？")) return;
              void composeDraft();
            }}
          >
            {busy === "compose" ? "重新成稿…" : "重新生成草稿"}
          </button>
          <a className="button secondary" href={`/api/public/creation/works/${work.id}/export`}>导出 Markdown</a>
          <button className="button" type="button" disabled={busy !== null || !editContent.trim()} onClick={scoreDraft}>
            {busy === "score" ? "AI 评审中…" : work.score === null ? "提交 AI 评分" : "重新评分"}
          </button>
        </div>
        {(touchedAfterScore || (isDirty && work.score !== null)) ? (
          <p className="muted">内容在评分后有改动，发布前需要重新评分。</p>
        ) : null}
      </section>

      {detail ? (
        <section className="form-card form-stack">
          <div className="row between">
            <h2>AI 评分</h2>
            <span className={`tag ${detail.publishable ? "creation-score-pass" : "creation-score-fail"}`}>
              总分 {detail.total} / 门槛 {detail.threshold}（{detail.publishable ? "已达标" : "未达标"}）
            </span>
          </div>
          {detail.overallComment ? <p className="muted-block">{detail.overallComment}</p> : null}
          <div className="creation-score-grid">
            {detail.dimensions.map((dim) => (
              <div key={dim.key} className="creation-score-item">
                <div className="row between">
                  <strong>{dim.label}</strong>
                  <span className="muted">{dim.score} 分 ｜ 权重 {Math.round(dim.weight * 100)}%</span>
                </div>
                <div className="creation-score-bar" role="img" aria-label={`${dim.label} ${dim.score} 分`}>
                  <span style={{ width: `${Math.min(100, Math.max(0, dim.score))}%` }} />
                </div>
                {dim.feedback ? <p className="muted">{dim.feedback}</p> : null}
              </div>
            ))}
          </div>
          {detail.suggestions.length > 0 ? (
            <div>
              <strong>修改建议（改完可重新评分）</strong>
              <ol className="creation-suggestions">
                {detail.suggestions.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {scoreValid && detail.publishable ? (
            showAnonConfirm && work.isAnonymous ? (
              <div className="creation-anon-confirm">
                <label className="creation-checkbox">
                  <input
                    type="checkbox"
                    checked={confirmAnonPublish}
                    onChange={(event) => setConfirmAnonPublish(event.target.checked)}
                  />
                  <span>
                    我了解：未登录发布的作品公开后<strong>不可删除</strong>。若想保留删除权，请先到
                    <Link className="text-link" href="/account">账户页</Link>注册（当前草稿会自动归入新账号）。
                  </span>
                </label>
                <div className="row-actions">
                  <button
                    className="button"
                    type="button"
                    disabled={busy !== null || !confirmAnonPublish}
                    onClick={() => publishWork(true)}
                  >
                    {busy === "publish" ? "发布中…" : "确认发布"}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      // 收起时同时清掉勾选，下次打开需要重新确认条款。
                      setShowAnonConfirm(false);
                      setConfirmAnonPublish(false);
                    }}
                  >
                    再想想
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="button"
                type="button"
                disabled={busy !== null}
                onClick={() => (work.isAnonymous ? setShowAnonConfirm(true) : publishWork(false))}
              >
                {busy === "publish" ? "发布中…" : "公开到社区"}
              </button>
            )
          ) : (
            <p className="muted">
              {detail.publishable
                ? "内容有改动，重新评分通过后即可发布。"
                : "达到门槛后这里会出现发布按钮。参考上面的反馈修改，然后重新评分。"}
            </p>
          )}
        </section>
      ) : null}

      <div className="row-actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            if (isDirty && !window.confirm("有未保存的修改，确定不保存就返回列表吗？")) return;
            setWork(null);
          }}
        >
          返回列表
        </button>
      </div>
    </div>
  );
}

function placeholderForGenre(slug: string) {
  switch (slug) {
    case "commentary":
      return "对这周某个热点事件，我有一个不同看法";
    case "tutorial":
      return "教大家用 30 分钟搭一个自己的博客";
    case "explainer":
      return "解释一下为什么天空是蓝色的";
    case "personal-story":
      return "记录我第一次独自旅行的经历";
    case "opinion":
      return "我认为远程办公被高估了";
    default:
      return "我想写……";
  }
}
