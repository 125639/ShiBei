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

// 访谈深度：短评 3 问；完整文章 8-10 问（满 8 问后模型可判定素材足够提前收尾）。
export const CREATION_DEPTHS: Record<
  CreationDepth,
  { minQuestions: number; maxQuestions: number; label: string; description: string }
> = {
  SHORT: { minQuestions: 3, maxQuestions: 3, label: "短评", description: "3 个问题，产出一条短评" },
  FULL: { minQuestions: 8, maxQuestions: 10, label: "完整文章", description: "8-10 个问题，产出一篇完整文章" }
};

export const CREATION_MODES: Record<CreationMode, { label: string; description: string }> = {
  VOICE_FIRST: {
    label: "我的话为主",
    description: "尽量保留你的原话，AI 只补结构和连接——最大化保留创作者的原意。"
  },
  AI_FIRST: {
    label: "AI 整合为主",
    description: "你的回答作为素材，由 AI 组织成完整文章——适合便捷的信息整合。"
  }
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

// 内容指纹：发布前校验「评分对应的就是当前这份内容」，改动后必须重新评分。
export function contentFingerprint(content: string) {
  return createHash("sha256").update(content.trim(), "utf8").digest("hex");
}

export function canPublishWork(input: {
  score: number | null;
  threshold: number;
  scoredHash: string | null;
  content: string;
}): { ok: true } | { ok: false; reason: string } {
  if (input.score === null || input.scoredHash === null) {
    return { ok: false, reason: "发布前需要先完成 AI 评分。" };
  }
  if (input.scoredHash !== contentFingerprint(input.content)) {
    return { ok: false, reason: "内容在评分后有改动，请重新评分后再发布。" };
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
