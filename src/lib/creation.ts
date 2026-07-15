import { createHash } from "crypto";
import type { PrismaClient, CreationDepth, CreationMode } from "@prisma/client";

// ============ 共创工作室：类型与纯函数 ============
// 本文件禁止引入 next/* —— prisma/seed.ts 与 tests/ 都直接运行它。

// 题材的评分维度。weight 为 0-1，题材内所有维度权重和应为 1。
// hint 会传给评分模型，说明这个维度到底看什么。
export type CreationDimension = {
  key: string;
  label: string;
  weight: number;
  hint: string;
};

// 访谈记录：一问一答。
export type InterviewEntry = {
  question: string;
  answer: string;
};

// 评分结果的持久化结构（存入 CreativeWork.scoreDetail）。
export type ScoreDimensionResult = {
  key: string;
  label: string;
  weight: number;
  score: number; // 0-100
  feedback: string; // 该维度的具体反馈（缺什么、哪里可以展开）
};

export type ScoreDetail = {
  dimensions: ScoreDimensionResult[];
  total: number; // 服务端按权重计算，不信任模型的算术
  threshold: number;
  publishable: boolean;
  overallComment: string;
  suggestions: string[]; // 具体可执行的修改建议
};

// 两档都会生成文章。SHORT 是历史枚举名，为兼容已有数据保留：
// 快速成文问 2-3 个关键问题；深度成文问 8-10 个问题。
export const CREATION_DEPTHS: Record<
  CreationDepth,
  { minQuestions: number; maxQuestions: number; label: string; description: string }
> = {
  SHORT: {
    minQuestions: 2,
    maxQuestions: 3,
    label: "快速成文",
    description: "2-3 个关键问题；你给方向，AI 补齐结构并生成一篇文章"
  },
  FULL: {
    minQuestions: 8,
    maxQuestions: 10,
    label: "深度成文",
    description: "8-10 个递进问题；充分表达材料，生成指向更明确的完整文章"
  }
};

export const CREATION_MODES: Record<CreationMode, { label: string; description: string }> = {
  VOICE_FIRST: {
    label: "我的话为主",
    description: "尽量保留你的原话，AI 只补结构和连接——最大化保留创作者的原意。"
  },
  AI_FIRST: {
    label: "AI 整合为主",
    description: "你的回答作为素材，由 AI 组织成完整文章——适合便捷的信息整合。"
  },
  MANUAL: {
    label: "纯手写",
    description: "文章由创作者从头到尾自己撰写，不经访谈或 AI 成稿。"
  }
};

/** 访谈启动 API 只接受这两种模式；MANUAL 走写作台交接流程。 */
export const INTERVIEW_CREATION_MODES = {
  VOICE_FIRST: CREATION_MODES.VOICE_FIRST,
  AI_FIRST: CREATION_MODES.AI_FIRST
};

// 未登录时单个 IP 最多生成的文章数（以「成稿」为准，不是开始访谈）。
export const ANON_WORK_LIMIT = 2;

export function parseGenreDimensions(json: string): CreationDimension[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const dimensions: CreationDimension[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const dim = item as Record<string, unknown>;
    const key = typeof dim.key === "string" ? dim.key.trim() : "";
    const label = typeof dim.label === "string" ? dim.label.trim() : "";
    const weight = typeof dim.weight === "number" && Number.isFinite(dim.weight) ? dim.weight : NaN;
    if (!key || !label || !(weight > 0)) continue;
    dimensions.push({
      key,
      label,
      weight,
      hint: typeof dim.hint === "string" ? dim.hint : ""
    });
  }
  return dimensions;
}

export function parseInterview(json: string): InterviewEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.question !== "string" || typeof entry.answer !== "string") return [];
    return [{ question: entry.question, answer: entry.answer }];
  });
}

// 加权总分：S = Σ wᵢ·scoreᵢ / Σ wᵢ。除以权重和是为了容忍权重没配成正好 1 的题材。
export function computeWeightedScore(
  dimensions: CreationDimension[],
  scores: Record<string, number>
): number {
  let weightSum = 0;
  let weighted = 0;
  for (const dim of dimensions) {
    const score = scores[dim.key];
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    const clamped = Math.min(100, Math.max(0, score));
    weightSum += dim.weight;
    weighted += dim.weight * clamped;
  }
  if (weightSum <= 0) return 0;
  return Math.round((weighted / weightSum) * 10) / 10;
}

export type WorkScoreSurface = { title: string; summary: string; content: string };
export type LegacyWorkScoreSurface = Pick<WorkScoreSurface, "title" | "content">;

function normalizeScoredContent(content: string) {
  // Markdown 的行首缩进、空行和行尾空格都可能改变渲染语义，不能 trim。
  // 只统一跨平台换行符，避免同一文本因 CRLF/LF 传输差异被迫重评。
  return content.replace(/\r\n?/g, "\n");
}

/**
 * 当前评分快照指纹：标题、公开摘要与正文都是社区读者实际看到的内容，也都会
 * 交给评分模型审查，因此必须作为一个不可拆分的发布快照。
 */
export function workScoreFingerprint(input: WorkScoreSurface) {
  const surface = JSON.stringify([
    input.title.trim(),
    input.summary.trim(),
    normalizeScoredContent(input.content)
  ]);
  return createHash("sha256").update(surface, "utf8").digest("hex");
}

/** migration 50000 已写入的旧治理指纹只包含标题+正文；仅用于兼容历史记录。 */
export function legacyWorkScoreFingerprint(input: LegacyWorkScoreSurface) {
  const surface = JSON.stringify([input.title.trim(), input.content.trim()]);
  return createHash("sha256").update(surface, "utf8").digest("hex");
}

export function isScoredSurfaceCurrent(input: WorkScoreSurface & {
  scoredHash: string | null;
}) {
  return Boolean(input.scoredHash && input.scoredHash === workScoreFingerprint(input));
}

export type WorkRubricSurface = {
  depth: CreationDepth;
  genre: Pick<{ name: string; dimensions: string; threshold: number }, "name" | "dimensions" | "threshold">;
};

/**
 * 评分标尺指纹：题材显示名、有效维度、公开门槛和篇幅预期都会进入评分提示，
 * 因而必须与分数一起绑定。JSON 格式和无意义首尾空白被规范化，避免纯格式调整
 * 迫使用户重评；维度顺序保留，因为它会改变模型逐项评审的顺序。
 */
export function workRubricFingerprint(input: WorkRubricSurface) {
  const dimensions = parseGenreDimensions(input.genre.dimensions).map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    weight: dimension.weight,
    hint: dimension.hint.trim()
  }));
  const surface = JSON.stringify({
    depth: input.depth,
    genreName: input.genre.name.trim(),
    dimensions,
    threshold: input.genre.threshold
  });
  return createHash("sha256").update(surface, "utf8").digest("hex");
}

export function isScoredRubricCurrent(input: WorkRubricSurface & {
  scoredRubricHash: string | null;
}) {
  return Boolean(
    input.scoredRubricHash && input.scoredRubricHash === workRubricFingerprint(input)
  );
}

/** 公开社区只能展示由当前 V2 评分快照实际覆盖过的摘要。 */
export function scoredCommunitySummary(input: WorkScoreSurface & {
  scoredHash: string | null;
}) {
  return isScoredSurfaceCurrent(input) ? input.summary : "";
}

/**
 * 分数与“当前门槛”同时展示时，公开表面和当前题材标尺必须都与评分时一致。
 * 迁移前缺少 rubric 指纹的历史分数不冒充当前标尺下的通过结果。
 */
export function isCommunityScoreCurrent(input: WorkScoreSurface & WorkRubricSurface & {
  scoredHash: string | null;
  scoredRubricHash: string | null;
}) {
  return isScoredSurfaceCurrent(input) && isScoredRubricCurrent(input);
}

export function ownerScorePresentation(input: WorkScoreSurface & WorkRubricSurface & {
  score: number | null;
  scoredHash: string | null;
  scoredRubricHash: string | null;
}) {
  const current = input.score !== null && isCommunityScoreCurrent(input);
  return {
    current,
    score: current ? input.score : null,
    hasHistoricalScore: input.score !== null && !current
  };
}

/** 导出文本不能把历史分数和当前题材门槛拼成一份并不存在的评审结论。 */
export function ownerExportScoreLabel(input: WorkScoreSurface & WorkRubricSurface & {
  score: number | null;
  scoredHash: string | null;
  scoredRubricHash: string | null;
}) {
  const presentation = ownerScorePresentation(input);
  if (presentation.current) {
    return `AI 评分：${presentation.score}/${input.genre.threshold}（公开门槛）`;
  }
  if (presentation.hasHistoricalScore) {
    return "AI 历史评分已失效（请按当前内容与标尺重新评分）";
  }
  return null;
}

export type ModeratedSurfaceSnapshot = {
  algorithm: "TITLE_CONTENT_V1" | "TITLE_SUMMARY_CONTENT_V2";
  surfaceHash: string;
  reason: string;
};

/** 找出当前公开表面命中的任一历史治理版本；只返回当前命中，不暴露其他原因。 */
export function findModeratedSurfaceMatch(
  input: WorkScoreSurface,
  history: readonly ModeratedSurfaceSnapshot[]
) {
  const currentHashes = {
    TITLE_CONTENT_V1: legacyWorkScoreFingerprint(input),
    TITLE_SUMMARY_CONTENT_V2: workScoreFingerprint(input)
  };
  return history.find(
    (surface) => surface.surfaceHash === currentHashes[surface.algorithm]
  ) ?? null;
}

/** 给作品所有者的可操作说明；原因只在所有权校验通过后返回。 */
export function moderationBlockedMessage(reason: string | null) {
  const suffix = reason?.trim() ? `治理原因：${reason.trim()}` : "请根据社区规范实质修改标题、摘要或正文。";
  return `当前版本与被社区下架的版本相同，不能评分或发布。${suffix}`;
}

/** SEO 描述只来自已评分的公开摘要/正文，绝不回退到未参与评分的 topic。 */
export function deriveCommunityDescription(summary: string, content: string, maxLength = 160) {
  const source = summary.trim() || content;
  const plain = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<(?:script|style|template)\b[^>]*>[\s\S]*?<\/(?:script|style|template)>/gi, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

/**
 * 社区详情页的 SEO 描述必须来自确实参与过当前评分快照的字段：V2 可以使用
 * 摘要并在摘要为空时回退正文；迁移前的 V1 只证明正文受过评审；无匹配快照
 * 时省略描述，避免把未评审内容放入搜索结果摘要。
 */
export function deriveScoredCommunityDescription(input: WorkScoreSurface & {
  scoredHash: string | null;
}) {
  if (isScoredSurfaceCurrent(input)) {
    return deriveCommunityDescription(input.summary, input.content);
  }
  if (
    input.scoredHash &&
    input.scoredHash === legacyWorkScoreFingerprint(input)
  ) {
    return deriveCommunityDescription("", input.content);
  }
  return null;
}

/** 判断一次草稿编辑是否改变了模型实际评分过的字段。 */
export function scoreSurfaceChanged(
  current: WorkScoreSurface,
  patch: Partial<WorkScoreSurface>
) {
  return workScoreFingerprint(current) !== workScoreFingerprint({
    title: patch.title ?? current.title,
    summary: patch.summary ?? current.summary,
    content: patch.content ?? current.content
  });
}

/** 所有持久化评分字段必须一起失效，不能留下可被发布接口误用的半份快照。 */
export function scoreInvalidationData() {
  return {
    score: null,
    scoreDetail: null,
    scoredAt: null,
    scoredHash: null,
    scoredRubricHash: null
  };
}

/**
 * 长任务写回时使用的版本条件。status + updatedAt 是当前 schema 下的乐观锁：
 * 任何并发编辑、成稿或发布都会令旧请求的最终 updateMany 命中 0 行。
 */
export function workRevisionWhere(input: {
  id: string;
  status: "INTERVIEWING" | "DRAFT" | "SHARED";
  updatedAt: Date;
}) {
  return { id: input.id, status: input.status, updatedAt: input.updatedAt };
}

/**
 * Anonymous deletion is additionally pinned to the irreversible publication
 * marker. This makes the policy atomic with DELETE, even if publish/unpublish
 * happens between the route's initial read and its deleteMany call.
 */
export function workDeletionWhere(input: {
  id: string;
  status: "INTERVIEWING" | "DRAFT" | "SHARED";
  updatedAt: Date;
  ownerId: string | null;
}) {
  return input.ownerId === null
    ? { ...workRevisionWhere(input), publishedOnceAt: null }
    : workRevisionWhere(input);
}

export function anonymousWorkWasPublished(input: {
  ownerId: string | null;
  publishedOnceAt: Date | null;
}) {
  return input.ownerId === null && input.publishedOnceAt !== null;
}

export function scoredSurfaceRevisionWhere(input: {
  id: string;
  status: "INTERVIEWING" | "DRAFT" | "SHARED";
  updatedAt: Date;
  title: string;
  summary: string;
  content: string;
}) {
  return {
    ...workRevisionWhere(input),
    title: input.title,
    summary: input.summary,
    content: input.content
  };
}

/** 发布 CAS 必须锁定版本、评分表面以及通过闸门的那份评分。 */
export function publicationSnapshotWhere(input: {
  id: string;
  status: "INTERVIEWING" | "DRAFT" | "SHARED";
  updatedAt: Date;
  title: string;
  summary: string;
  content: string;
  score: number | null;
  scoredHash: string | null;
  scoredRubricHash: string | null;
}) {
  return {
    ...scoredSurfaceRevisionWhere(input),
    score: input.score,
    scoredHash: input.scoredHash,
    scoredRubricHash: input.scoredRubricHash
  };
}

/** 核验澄清会退回访谈态，但绝不覆盖旧草稿；旧评分同时作废。 */
export function verificationClarificationData(
  status: "INTERVIEWING" | "DRAFT" | "SHARED",
  pendingQuestion: string
) {
  return status === "DRAFT"
    ? {
        status: "INTERVIEWING" as const,
        pendingQuestion,
        ...scoreInvalidationData()
      }
    : { pendingQuestion };
}

export function canPublishWork(input: {
  score: number | null;
  threshold: number;
  scoredHash: string | null;
  scoredRubricHash: string | null;
  currentRubricHash: string;
  title: string;
  summary: string;
  content: string;
  moderationBlocked?: boolean;
  moderationReason?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (input.moderationBlocked) {
    return { ok: false, reason: moderationBlockedMessage(input.moderationReason ?? null) };
  }
  if (input.score === null || input.scoredHash === null) {
    return { ok: false, reason: "发布前需要先完成 AI 评分。" };
  }
  if (!isScoredSurfaceCurrent(input)) {
    return { ok: false, reason: "标题、摘要或正文在评分后有改动，请重新评分后再发布。" };
  }
  if (input.scoredRubricHash !== input.currentRubricHash) {
    return { ok: false, reason: "题材评分标尺或篇幅预期在评分后有变化，请按当前标尺重新评分。" };
  }
  if (input.score < input.threshold) {
    return { ok: false, reason: `当前得分 ${input.score} 未达到该题材的公开门槛 ${input.threshold}，请参考评分反馈修改后重新评分。` };
  }
  return { ok: true };
}

// ============ 默认题材（评分标尺挂在题材上） ============
// R=严谨性 P=实效性 T=时效性；个人叙事把 R 换成情感真实度/细节具体性。
// 管理员可直接改数据库行调整权重与阈值，seed 只补缺不覆盖。

type DefaultGenre = {
  slug: string;
  name: string;
  description: string;
  dimensions: CreationDimension[];
  threshold: number;
  sortOrder: number;
};

export const DEFAULT_CREATION_GENRES: DefaultGenre[] = [
  {
    slug: "commentary",
    name: "时事快评",
    description: "针对近期事件的短平快评论，时效性权重最高。",
    threshold: 70,
    sortOrder: 1,
    dimensions: [
      { key: "rigor", label: "严谨性", weight: 0.3, hint: "事实与论据是否可靠、可核实，论证是否自洽，有没有明显的以偏概全" },
      { key: "practical", label: "实效性", weight: 0.25, hint: "观点是否给读者带来可用的判断视角或行动参考，而不是空泛表态" },
      { key: "timely", label: "时效性", weight: 0.45, hint: "话题是否新近、是否抓住当下讨论的关键点，引用的信息是否过时" }
    ]
  },
  {
    slug: "tutorial",
    name: "教程指南",
    description: "教读者做成一件事，实效性权重最高。",
    threshold: 70,
    sortOrder: 2,
    dimensions: [
      { key: "rigor", label: "严谨性", weight: 0.3, hint: "步骤是否准确，术语是否正确，关键操作有没有交代前提和风险" },
      { key: "practical", label: "实效性", weight: 0.5, hint: "读者能否照着做成：步骤是否完整可复现，有没有跳步或缺少关键参数" },
      { key: "timely", label: "时效性", weight: 0.2, hint: "方法、版本、工具是否仍然适用，是否注明了适用范围" }
    ]
  },
  {
    slug: "explainer",
    name: "科普解读",
    description: "把一个概念或现象讲清楚，严谨性权重最高。",
    threshold: 70,
    sortOrder: 3,
    dimensions: [
      { key: "rigor", label: "严谨性", weight: 0.5, hint: "概念解释是否准确、无常识性错误，因果推断是否成立，是否区分了事实与推测" },
      { key: "practical", label: "实效性", weight: 0.3, hint: "读者读完能否真正理解并向别人复述，例子是否贴近生活" },
      { key: "timely", label: "时效性", weight: 0.2, hint: "引用的研究或数据是否过时，是否反映了当前的主流认识" }
    ]
  },
  {
    slug: "personal-story",
    name: "个人叙事",
    description: "个人经历与感受的记录，用情感真实度和细节具体性取代严谨性。",
    threshold: 65,
    sortOrder: 4,
    dimensions: [
      { key: "authenticity", label: "情感真实度", weight: 0.4, hint: "情感是否真诚可信，有没有真实的心理活动与转折，而不是套话和口号" },
      { key: "detail", label: "细节具体性", weight: 0.35, hint: "是否有具体的场景、对话、感官细节和原话，而不是抽象概括" },
      { key: "clarity", label: "表达清晰度", weight: 0.25, hint: "叙述是否流畅，时间线与人物关系是否清楚" }
    ]
  },
  {
    slug: "opinion",
    name: "观点评论",
    description: "论证一个立场，看重论证质量与话题热度的平衡。",
    threshold: 70,
    sortOrder: 5,
    dimensions: [
      { key: "rigor", label: "严谨性", weight: 0.4, hint: "论点是否有论据支撑，是否回应了主要的反方观点，逻辑链条是否完整" },
      { key: "practical", label: "实效性", weight: 0.25, hint: "观点是否能帮读者形成自己的判断，是否提供了新的思考角度" },
      { key: "timely", label: "时效性", weight: 0.35, hint: "所评论的话题是否仍在公共讨论中，切入点是否新鲜" }
    ]
  }
];

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

// 与 seedDefaultTopics 相同的语义：只补缺失的题材，不覆盖管理员已调整的权重/阈值。
export async function seedDefaultCreationGenres(prisma: PrismaClient) {
  for (const genre of DEFAULT_CREATION_GENRES) {
    const existing = await prisma.creationGenre.findUnique({ where: { slug: genre.slug }, select: { id: true } });
    if (existing) continue;

    try {
      await prisma.creationGenre.create({
        data: {
          slug: genre.slug,
          name: genre.name,
          description: genre.description,
          dimensions: JSON.stringify(genre.dimensions),
          threshold: genre.threshold,
          sortOrder: genre.sortOrder,
          isEnabled: true
        }
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const createdByAnotherProcess = await prisma.creationGenre.findUnique({
        where: { slug: genre.slug },
        select: { id: true }
      });
      if (!createdByAnotherProcess) throw error;
    }
  }
}
