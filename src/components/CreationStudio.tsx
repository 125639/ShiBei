"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ANON_CREATION_SEED_HEADER,
  ensureAnonymousBootstrap
} from "@/lib/client/anon-bootstrap";
import { markdownToHtml } from "@/lib/markdown";
import { TaskProgress } from "./TaskProgress";
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
type InterviewModeKey = "VOICE_FIRST" | "AI_FIRST";
type ModeKey = InterviewModeKey | "MANUAL";

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
  scoreCurrent: boolean;
  hasHistoricalScore: boolean;
  scoreRubricCurrent: boolean;
  moderationReason: string | null;
  moderationBlocked: boolean;
  publishedAt: string | null;
  updatedAt: string;
};

type WorkListItem = {
  id: string;
  slug: string | null;
  status: Work["status"];
  topic: string;
  title: string;
  score: number | null;
  scoreCurrent: boolean;
  hasHistoricalScore: boolean;
  updatedAt: string;
  genre: { name: string; threshold: number };
};

type WorkListPage = {
  works: WorkListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  isMember: boolean;
  anonQuotaRemaining: number | null;
  anonWorkLimit: number;
};

const STATUS_LABELS: Record<Work["status"], string> = {
  INTERVIEWING: "访谈中",
  DRAFT: "草稿",
  SHARED: "已公开"
};

const BUSY_PROGRESS: Record<string, { label: string; stage: string }> = {
  start: { label: "正在准备访谈", stage: "AI 正在生成第一个具体问题" },
  answer: { label: "正在处理回答", stage: "AI 正在判断素材并准备下一问" },
  compose: { label: "正在生成草稿", stage: "AI 正在整理材料、核验并成稿" },
  save: { label: "正在保存修改", stage: "正在写入你的私有草稿" },
  score: { label: "正在评审草稿", stage: "AI 正在按已选标尺逐项评分" },
  publish: { label: "正在发布作品", stage: "正在保存公开版本并刷新社区" },
  resume: { label: "正在打开作品", stage: "正在读取最近保存的内容" }
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
  const [modes, setModes] = useState<Record<InterviewModeKey, ModeMeta> | null>(null);
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [worksNextCursor, setWorksNextCursor] = useState<string | null>(null);
  const [worksLoadingMore, setWorksLoadingMore] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [quotaLimit, setQuotaLimit] = useState(2);
  const [loadError, setLoadError] = useState("");

  const [work, setWork] = useState<Work | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // 第一步：题材（=评分标尺）、模式、深度、主题
  const [genreId, setGenreId] = useState("");
  // 快速成文的目标是「用户给方向即可」，默认让 AI 承担资料组织；
  // 仍保留「我的话为主」供希望最大程度保留原话的创作者选择。
  const [mode, setMode] = useState<InterviewModeKey>("AI_FIRST");
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
  const [interviewFallbackNotice, setInterviewFallbackNotice] = useState(false);
  const worksRequestRef = useRef(0);
  const worksPageLoadingRef = useRef(false);

  const refreshWorks = useCallback(async () => {
    const requestId = ++worksRequestRef.current;
    await ensureAnonymousBootstrap();
    const data = await requestJson<WorkListPage>("/api/public/creation/works");
    if (requestId !== worksRequestRef.current) return;
    setWorks(data.works);
    setWorksNextCursor(data.nextCursor);
    setIsMember(data.isMember);
    setQuotaRemaining(data.anonQuotaRemaining);
    setQuotaLimit(data.anonWorkLimit);
  }, []);

  const loadMoreWorks = useCallback(async () => {
    const cursor = worksNextCursor;
    if (!cursor || worksPageLoadingRef.current) return;
    const requestId = worksRequestRef.current;
    worksPageLoadingRef.current = true;
    setWorksLoadingMore(true);
    setError("");
    try {
      await ensureAnonymousBootstrap();
      const data = await requestJson<WorkListPage>(
        `/api/public/creation/works?cursor=${encodeURIComponent(cursor)}`
      );
      // A login/logout or full refresh may have changed the active identity
      // while this page was in flight. Never append that stale identity page.
      if (requestId !== worksRequestRef.current) return;
      setWorks((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...data.works.filter((item) => !existing.has(item.id))];
      });
      setWorksNextCursor(data.nextCursor);
    } catch (err) {
      if (requestId === worksRequestRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      worksPageLoadingRef.current = false;
      setWorksLoadingMore(false);
    }
  }, [worksNextCursor]);

  useEffect(() => {
    (async () => {
      try {
        // 先让同源标签页收敛到唯一匿名身份，再并发读取任何私有列表/指定作品。
        await ensureAnonymousBootstrap();
        const requestedWorkId = new URLSearchParams(window.location.search).get("work")?.trim() || "";
        const [genreData] = await Promise.all([
          requestJson<{ genres: Genre[]; depths: Record<DepthKey, DepthMeta>; modes: Record<InterviewModeKey, ModeMeta> }>(
            "/api/public/creation/genres"
          ),
          refreshWorks()
        ]);
        setGenres(genreData.genres);
        setDepths(genreData.depths);
        setModes(genreData.modes);
        if (genreData.genres.length > 0) setGenreId(genreData.genres[0].id);
        if (requestedWorkId) {
          // ?work= 指向的作品可能已被删除、身份已轮换或链接已过期。这只影响
          // “继续这篇”，不能把整个创作台变成不可用的错误页。
          try {
            const requestedWork = await requestJson<{ work: Work }>(
              `/api/public/creation/works/${encodeURIComponent(requestedWorkId)}`
            );
            setWork(requestedWork.work);
            setComposeNotes([]);
            setTouchedAfterScore(false);
          } catch (err) {
            setError(`未能打开链接指向的作品（可能已删除或归属其他身份）：${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [refreshWorks]);

  useEffect(() => {
    if (work?.status !== "DRAFT") return;
    const timer = window.setTimeout(() => {
      setEditTitle(work.title);
      setEditSummary(work.summary);
      setEditContent(work.content);
    }, 0);
    return () => window.clearTimeout(timer);
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
      const anonymousSeed = await ensureAnonymousBootstrap();
      const data = await requestJson<{ work: Work; questionFallback?: boolean }>("/api/public/creation/works", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [ANON_CREATION_SEED_HEADER]: anonymousSeed
        },
        body: JSON.stringify({ genreId, mode, depth, topic })
      });
      setWork(data.work);
      setInterviewFallbackNotice(Boolean(data.questionFallback));
      setTouchedAfterScore(false);
      setComposeNotes([]);
      await refreshWorks();
    });

  const submitAnswer = () =>
    run("answer", async () => {
      if (!work) return;
      const data = await requestJson<{ done: boolean; work: Work; questionFallback?: boolean }>(
        `/api/public/creation/works/${work.id}/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer, expectedUpdatedAt: work.updatedAt })
        }
      );
      setWork(data.work);
      setInterviewFallbackNotice(Boolean(data.questionFallback));
      setAnswer("");
    });

  const composeDraft = () =>
    run("compose", async () => {
      if (!work) return;
      const response = await fetch(`/api/public/creation/works/${work.id}/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: work.updatedAt })
      });
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
        body: JSON.stringify({
          title: editTitle,
          summary: editSummary,
          content: editContent,
          expectedUpdatedAt: work.updatedAt
        })
      });
      if (
        work.score !== null
        && (editTitle !== work.title || editSummary !== work.summary || editContent !== work.content)
      ) {
        setTouchedAfterScore(true);
      }
      setWork(data.work);
    });

  const scoreDraft = () =>
    run("score", async () => {
      if (!work) return;
      let workForScore = work;
      if (isDirty) {
        const saved = await requestJson<{ work: Work }>(`/api/public/creation/works/${work.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editTitle,
            summary: editSummary,
            content: editContent,
            expectedUpdatedAt: work.updatedAt
          })
        });
        setWork(saved.work);
        workForScore = saved.work;
      }
      const data = await requestJson<{ work: Work }>(`/api/public/creation/works/${work.id}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: workForScore.updatedAt })
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
          body: JSON.stringify({
            confirmAnonymousNoDelete: confirmed,
            expectedUpdatedAt: work.updatedAt
          })
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
      setInterviewFallbackNotice(false);
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
  const busyProgress = busy ? BUSY_PROGRESS[busy] : null;

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
          <ol className="creation-flow-guide" aria-label="共创流程">
            <li><span>1</span><strong>选题材</strong><small>同时确定评分标尺</small></li>
            <li><span>2</span><strong>选择写法</strong><small>接受访谈，或完全自己写</small></li>
            <li><span>3</span><strong>编辑与核验</strong><small>评分达标后由你决定是否公开</small></li>
          </ol>
          <p className="muted-block">
            你的内容默认私有：访谈与草稿只有你自己可见，在你主动点击发布之前，绝不会公开。
            {!isMember && quotaRemaining !== null ? (
              <>
                {" "}未登录状态下单个 IP 最多生成 {quotaLimit} 篇（还剩 {quotaRemaining} 篇），且发布后不可删除；
                <Link className="text-link" href="/account">登录或注册账号</Link>后，新建作品不受匿名额度限制并可随时删除、导出；当前匿名作品不会转入账号。
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
                {(Object.keys(modes) as InterviewModeKey[]).map((key) => (
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
                <Link className="creation-option-card creation-manual-card" href="/write?mode=manual">
                  <strong>纯手写</strong>
                  <span className="muted">从空白文档直接写，不经过 AI 访谈或自动成稿；自动保存并可导出 Markdown。</span>
                  <span className="creation-manual-link">进入纯手写写作台 →</span>
                </Link>
              </div>
            </fieldset>
          ) : null}

          {depths ? (
            <fieldset className="field creation-choice-field">
              <legend>3. 访谈深度（两档都会生成文章）</legend>
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

          {busyProgress ? (
            <TaskProgress label={busyProgress.label} stage={busyProgress.stage} active />
          ) : null}
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
                      {item.score !== null
                        ? ` ｜ ${item.score} 分（门槛 ${item.genre.threshold}）`
                        : item.hasHistoricalScore
                          ? " ｜ 历史评分已失效"
                          : ""}
                    </span>
                  </button>
                  {item.status === "SHARED" && item.slug ? (
                    <Link className="text-link" href={`/community/${item.slug}`}>查看</Link>
                  ) : null}
                </li>
              ))}
            </ul>
            {worksNextCursor ? (
              <button
                className="button secondary"
                type="button"
                data-testid="creation-load-more"
                disabled={busy !== null || worksLoadingMore}
                aria-busy={worksLoadingMore}
                onClick={() => void loadMoreWorks()}
              >
                {worksLoadingMore ? "正在加载更多作品…" : "加载更多作品"}
              </button>
            ) : null}
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
            <span className="tag">{work.genre.name} ｜ 已答 {work.interview.length} / {total} 题</span>
          </div>
          <TaskProgress
            label={`访谈进度：已回答 ${work.interview.length} 题`}
            stage={work.interview.length >= work.minQuestions ? "已达到可成稿题数" : `至少回答 ${work.minQuestions} 题`}
            value={work.interview.length}
            max={work.maxQuestions}
          />
          {work.content.trim() ? (
            <p className="muted-block">
              上一次草稿仍安全保留。请完成下面的事实核验说明；重新成稿成功前，原草稿不会被覆盖或公开。
            </p>
          ) : null}
          {interviewFallbackNotice ? (
            <p className="muted-block" role="status">
              写作模型暂时不可用，当前问题来自内置访谈提纲。你的回答仍会正常保存；服务恢复后可继续让 AI 成稿或重新生成草稿。
            </p>
          ) : null}
          {busyProgress ? (
            <TaskProgress label={busyProgress.label} stage={busyProgress.stage} active />
          ) : null}
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
              <p className="muted-block">访谈完成。AI 会按你选择的深度生成一篇可编辑文章——内容经你过目、修改并主动发布后才会公开。</p>
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
            <a className="button secondary" href={`/api/public/creation/works/${work.id}/export`} download>导出 Markdown</a>
            <button className="button secondary" type="button" onClick={() => setWork(null)}>返回列表</button>
          </div>
        </section>
      </div>
    );
  }

  // ============ 第三步：草稿编辑 + 评分 + 发布 ============
  const detail = work.scoreDetail;
  const scoreValid = work.scoreCurrent && work.score !== null && !touchedAfterScore && !isDirty;
  const isManualWork = work.mode === "MANUAL";
  const moderationSurfaceDirty =
    editTitle.trim() !== work.title.trim()
    || editSummary.trim() !== work.summary.trim()
    || editContent.trim() !== work.content.trim();
  return (
    <div className="creation-studio" data-testid={isManualWork ? "manual-creative-work" : undefined}>
      <section className="form-card form-stack">
        <div className="row between">
          <h2>{isManualWork ? "纯手写作品草稿" : "可编辑草稿"}</h2>
          <span className="tag">{work.genre.name} ｜ 公开门槛 ≥ {work.genre.threshold} 分</span>
        </div>
        {busyProgress ? (
          <TaskProgress label={busyProgress.label} stage={busyProgress.stage} active />
        ) : null}
        <p className="muted-block">
          {isManualWork
            ? "这是你完全手写的作品，完成与交接过程没有调用 AI。你可继续修改；只有主动点击「提交 AI 评分」才会进行评审，达标后仍由你决定是否公开。"
            : "这是 AI 根据访谈生成的草稿，不会直接存档或公开——内容始终经你本人过目修改，评分达标后由你决定是否发布。"}
        </p>

        {work.hasHistoricalScore ? (
          <p className="muted-block" role="status">
            历史评分已失效，不能代表当前内容达到当前题材门槛；请重新提交 AI 评分。
          </p>
        ) : null}

        {work.moderationReason ? (
          <div className="muted-block creation-error" role="status" data-testid="creation-moderation-lock">
            <strong>
              {work.moderationBlocked && !moderationSurfaceDirty
                ? "当前标题、摘要与正文仍是被下架版本，不能评分或发布。"
                : "这篇作品曾被下架；当前修改可提交，但服务端仍会阻止恢复被下架的原版本。"}
            </strong>
            <br />治理原因：{work.moderationReason}
          </div>
        ) : null}

        {!isManualWork && composeNotes.length > 0 ? (
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
          {!isManualWork ? (
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
          ) : null}
          <a className="button secondary" href={`/api/public/creation/works/${work.id}/export`} download>导出 Markdown</a>
          <button
            className="button"
            type="button"
            disabled={
              busy !== null
              || !editContent.trim()
              || (work.moderationBlocked && !moderationSurfaceDirty)
            }
            onClick={scoreDraft}
          >
            {busy === "score" ? "AI 评审中…" : work.score === null ? "提交 AI 评分" : "重新评分"}
          </button>
        </div>
        {(touchedAfterScore || (isDirty && work.score !== null)) ? (
          <p className="muted">标题、摘要或正文在评分后有改动，发布前需要重新评分。</p>
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
                    <Link className="text-link" href="/account">账户页</Link>登录或注册后新建作品；当前匿名草稿不会转入账号。
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
                ? work.scoreRubricCurrent
                  ? "内容有改动，重新评分通过后即可发布。"
                  : "题材评分标尺或篇幅预期已更新，请按当前标尺重新评分。"
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
