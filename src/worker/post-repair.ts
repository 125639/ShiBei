import { Prisma, type ContentStyle, type ModelConfig } from "@prisma/client";
import {
  generateContentArticle,
  generateSummary,
  isInsufficientEvidenceOutput,
  repairUnpublishableArticle,
  type EvidenceItem
} from "../lib/ai";
import { getModelConfigForUse } from "../lib/model-selection";
import {
  assessPostPublicationRequest,
  requiresGeneratedArticleGate
} from "../lib/post-publication";
import { extractTitleAndSummary } from "../lib/post-derive";
import {
  assessPostRepairMediaIntegrity,
  buildPostRepairUrl,
  buildTrustedResearchInventoryUpgrade,
  encodePostRepairResult,
  extractLegacyPostRepairEvidence,
  extractTrustedPostRepairEvidence,
  POST_REPAIR_MAX_ATTEMPTS,
  postRepairEvidenceRevision,
  postRepairGuidance,
  runPostRepairRounds,
  type PostRepairDraft,
  type PostRepairLoopResult,
  type PostRepairResult,
  type PostRepairRound
} from "../lib/post-repair";
import {
  generationPublicationBlockReason,
  stripNonPublishableGenerationMarker
} from "../lib/publication-policy";
import { prisma } from "../lib/prisma";
import { assessEvidenceSufficiency, normalizeUrl, UnpublishableGeneratedArticleError } from "../lib/source-quality";
import { parseKeywordResearchUrl, type ResearchDepth } from "../lib/research";
import { revalidateArchivedEvidence, selectWritingEvidence } from "./evidence";
import { notifyPublicContentRevalidation } from "./public-cache";
import { assessEvidenceClaimConsistency } from "../lib/evidence-claim-consistency";

type PostRepairRequest = {
  postId: string;
  expectedUpdatedAt: Date;
  evidenceRevision: string;
};

type PostSnapshot = Awaited<ReturnType<typeof loadPostSnapshot>>;

type ResolvedPostRepairEvidence = {
  evidence: EvidenceItem[];
  allowedSourceUrls: string[];
  upgradedMarkdown: string | null;
};

type EvidenceResolution =
  | { ok: true; value: ResolvedPostRepairEvidence }
  | { ok: false; reason: string };

export async function processPostRepair(fetchJobId: string, request: PostRepairRequest) {
  const [fetchJob, post] = await Promise.all([
    prisma.fetchJob.findUniqueOrThrow({ where: { id: fetchJobId } }),
    loadPostSnapshot(request.postId)
  ]);
  if (!post) {
    throwRepairFailure(resultForFailure(request.postId, "已删除的文章", "文章已被删除，返修任务已停止", 0, []));
  }

  const initialResult = baseResult(post.id, post.title, "RUNNING", "正在执行首次发布检查");
  await writeRepairResult(fetchJobId, initialResult);

  const conflict = initialConflictReason(post, request);
  if (conflict) {
    await failRepair(fetchJobId, post, conflict, 0, []);
  }
  if (post.status !== "DRAFT") {
    await failRepair(fetchJobId, post, "AI 自动返修只处理未发布草稿；文章状态已经变化，请刷新列表后确认", 0, []);
  }
  if (post.pendingRevision !== null) {
    await failRepair(fetchJobId, post, "文章包含待审核修改，AI 不能替管理员决定采用哪个版本", 0, []);
  }
  const invalidVideoReason = await postVideoIntegrityReason(post.id, post.content);
  if (invalidVideoReason) {
    await failRepair(fetchJobId, post, invalidVideoReason, 0, []);
  }

  const generatedArtifact = requiresGeneratedArticleGate({
    hasRawItem: Boolean(post.rawItemId),
    artifactKind: post.rawItem?.artifactKind,
    sourceType: post.rawItem?.fetchJob?.sourceType
  });
  let resolvedEvidence: ResolvedPostRepairEvidence = {
    evidence: [],
    allowedSourceUrls: post.sourceUrl && /^https?:\/\//i.test(post.sourceUrl) ? [post.sourceUrl] : [],
    upgradedMarkdown: null
  };
  if (generatedArtifact) {
    const resolved = await resolvePostRepairEvidence(post);
    if (!resolved.ok) {
      return failRepair(fetchJobId, post, resolved.reason, 0, []);
    }
    resolvedEvidence = resolved.value;
    if (resolvedEvidence.upgradedMarkdown) {
      try {
        request.evidenceRevision = await persistEvidenceUpgrade(
          fetchJobId,
          post,
          request,
          resolvedEvidence.upgradedMarkdown
        );
        resolvedEvidence = { ...resolvedEvidence, upgradedMarkdown: null };
      } catch (error) {
        return failRepair(fetchJobId, post, errorMessage(error), 0, []);
      }
    }
  }
  const { evidence, allowedSourceUrls } = resolvedEvidence;
  const initialDraft: PostRepairDraft = {
    title: post.title,
    summary: post.summary,
    content: stripNonPublishableGenerationMarker(post.content)
  };
  const assess = (draft: PostRepairDraft) => {
    if (generatedArtifact) {
      const claimAssessment = assessEvidenceClaimConsistency(draft.content, evidence);
      if (!claimAssessment.ok) return claimAssessment;
    }
    return assessPostPublicationRequest({
      requestedStatus: "PUBLISHED",
      publicationBlockedReason: post.publicationBlockedReason,
      title: draft.title,
      summary: draft.summary,
      content: draft.content,
      generatedArtifact,
      allowedSourceUrls
    });
  };

  const initialAssessment = assess(initialDraft);
  if (initialAssessment.ok) {
    const success = {
      ...baseResult(post.id, initialDraft.title, "PUBLISHED" as const, "无需返修，首次检查通过并已发布"),
      attempts: 0
    };
    try {
      const slug = await publishCandidate(fetchJobId, post, request, initialDraft, generatedArtifact, resolvedEvidence, success);
      await notifyPublicContentRevalidation([`/posts/${slug}`]);
    } catch (error) {
      await failRepair(fetchJobId, post, errorMessage(error), 0, []);
    }
    return;
  }

  if (!generatedArtifact) {
    await failRepair(
      fetchJobId,
      post,
      `这不是带原始研究证据的 AI 生成稿，不能自动改写：${initialAssessment.reason}`,
      0,
      []
    );
  }
  if (!allowedSourceUrls.length) {
    await failRepair(fetchJobId, post, "该草稿没有可核验的原始来源，AI 不能在没有事实依据时继续改写", 0, []);
  }
  if (!evidence.length) {
    await failRepair(fetchJobId, post, "来源白名单存在，但原始正文证据已经缺失，无法安全交给 AI 返修", 0, []);
  }

  const diagnostic = generationPublicationBlockReason({
    summary: initialDraft.summary,
    content: initialDraft.content,
    generatedArtifact: true
  });
  const [modelConfig, style] = await Promise.all([
    fetchJob.modelConfigId
      ? prisma.modelConfig.findUnique({ where: { id: fetchJob.modelConfigId } })
      : getModelConfigForUse("content"),
    fetchJob.contentStyleId
      ? prisma.contentStyle.findUnique({ where: { id: fetchJob.contentStyleId } })
      : prisma.contentStyle.findFirst({ orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] })
  ]);
  if (!modelConfig) {
    return failRepair(fetchJobId, post, "尚未配置可用的内容模型，无法执行自动返修", 0, []);
  }
  if (!style) {
    return failRepair(fetchJobId, post, "尚未配置内容风格，无法按原生成协议重新审校", 0, []);
  }

  // Diagnostic placeholders (including old “资料不足” drafts) are regenerated
  // only after the current evidence selector has independently passed. A stale
  // historical block is therefore repairable, while genuinely thin sources
  // have already stopped above without asking the model to invent facts.
  const needsRegeneration = Boolean(diagnostic);
  let firstRoundRegenerates = needsRegeneration;
  let loop: PostRepairLoopResult;
  let completedAttempts = 0;
  let completedRounds: PostRepairRound[] = [];
  let activeRound = 0;
  let activeAction: PostRepairRound["action"] = "repair";
  try {
    loop = await runPostRepairRounds({
      initialDraft,
      assess,
      maxAttempts: POST_REPAIR_MAX_ATTEMPTS,
      revise: async (draft, reason, round) => {
        const regenerate = firstRoundRegenerates;
        activeRound = round;
        activeAction = regenerate ? "regenerate" : "repair";
        firstRoundRegenerates = false;
        const content = regenerate
          ? await regenerateFromEvidence({ post, evidence, modelConfig, style })
          : await repairUnpublishableArticle({
            modelConfig,
            article: draft.content,
            gateReason: reason,
            allowedUrls: allowedSourceUrls,
            evidence,
            minimumOutputTokens: outputTokenTarget(style.length),
            repairRound: round,
            maxRepairRounds: POST_REPAIR_MAX_ATTEMPTS
          });

        if (isInsufficientEvidenceOutput(content)) {
          return {
            draft,
            action: regenerate ? "regenerate" as const : "repair" as const,
            stopReason: `AI 在第 ${round} 轮确认现有资料不足：${content.slice(0, 220)}`
          };
        }

        const parsed = extractTitleAndSummary(content, draft.title);
        const revised = { title: parsed.title, summary: parsed.summary, content };
        const media = assessPostRepairMediaIntegrity(draft.content, revised.content);
        return {
          draft: media.ok ? revised : draft,
          action: regenerate ? "regenerate" as const : "repair" as const,
          ...(!media.ok ? { rejectionReason: media.reason } : {})
        };
      },
      onRound: async ({ draft, attempts, reason, rounds }) => {
        completedAttempts = attempts;
        completedRounds = [...rounds];
        await writeRepairResult(fetchJobId, {
          ...baseResult(post.id, draft.title, "RUNNING", `第 ${attempts}/${POST_REPAIR_MAX_ATTEMPTS} 轮已复检`),
          attempts,
          reason,
          guidance: null,
          rounds
        });
      }
    });
  } catch (error) {
    const modelReason = `模型返修调用失败：${errorMessage(error)}`;
    const failedRounds = activeRound > completedAttempts
      ? [...completedRounds, { round: activeRound, action: activeAction, reason: modelReason }]
      : completedRounds;
    return failRepair(
      fetchJobId,
      post,
      modelReason,
      Math.max(completedAttempts, activeRound),
      failedRounds
    );
  }

  if (!loop.ok) {
    return failRepair(fetchJobId, post, loop.reason || "三轮返修后仍未通过发布检查", loop.attempts, loop.rounds);
  }

  const success = {
    ...baseResult(post.id, loop.draft.title, "PUBLISHED" as const, `第 ${loop.attempts} 轮返修通过，已发布`),
    attempts: loop.attempts,
    rounds: loop.rounds
  };
  try {
    const slug = await publishCandidate(fetchJobId, post, request, loop.draft, generatedArtifact, resolvedEvidence, success);
    await notifyPublicContentRevalidation([`/posts/${slug}`]);
  } catch (error) {
    return failRepair(fetchJobId, post, errorMessage(error), loop.attempts, loop.rounds);
  }
}

async function loadPostSnapshot(postId: string) {
  return prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      content: true,
      sourceUrl: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
      rawItemId: true,
      publicationBlockedReason: true,
      pendingRevision: true,
      rawItem: {
        select: {
          id: true,
          title: true,
          url: true,
          content: true,
          markdown: true,
          artifactKind: true,
          fetchJob: { select: { sourceType: true, sourceUrl: true } }
        }
      }
    }
  });
}

function initialConflictReason(post: NonNullable<PostSnapshot>, request: PostRepairRequest) {
  if (post.updatedAt.getTime() !== request.expectedUpdatedAt.getTime()) {
    return "任务创建后文章已被修改，自动返修已停止以免覆盖管理员的新版本";
  }
  const evidenceRevision = evidenceRevisionForPost(post);
  if (evidenceRevision !== request.evidenceRevision) {
    return "任务创建后原始来源资料已变化，必须基于最新证据重新审核";
  }
  return null;
}

function evidenceRevisionForPost(post: NonNullable<PostSnapshot>) {
  return postRepairEvidenceRevision({
    rawItemId: post.rawItem?.id,
    title: post.rawItem?.title,
    url: post.rawItem?.url,
    content: post.rawItem?.content,
    markdown: post.rawItem?.markdown,
    artifactKind: post.rawItem?.artifactKind,
    sourceType: post.rawItem?.fetchJob?.sourceType,
    fetchSourceUrl: post.rawItem?.fetchJob?.sourceUrl
  });
}

async function resolvePostRepairEvidence(post: NonNullable<PostSnapshot>): Promise<EvidenceResolution> {
  if (!post.rawItem) {
    return { ok: false, reason: "该草稿没有原始研究条目，AI 无法核验事实来源" };
  }

  const trusted = extractTrustedPostRepairEvidence({
    title: post.rawItem.title,
    url: post.rawItem.url,
    content: post.rawItem.content,
    markdown: post.rawItem.markdown
  });
  if (trusted.length) {
    const sufficiency = assessEvidenceSufficiency(trusted, evidencePolicyForPost(post, trusted.length));
    if (!sufficiency.ok) {
      return { ok: false, reason: `当前可信资料不足以安全返修：${sufficiency.reason}` };
    }
    return {
      ok: true,
      value: {
        evidence: trusted,
        allowedSourceUrls: uniqueEvidenceUrls(trusted),
        upgradedMarkdown: null
      }
    };
  }

  if (post.rawItem.url.startsWith("digest://")) {
    return {
      ok: false,
      reason: "这是一篇没有可信时间清单的历史日报/周报；系统不能用无日期或超出原时间窗的资料返修，请重跑原定时报任务"
    };
  }

  // Rows created before the manifest existed are discovery records only. Even
  // their readable “正文资料” list is untrusted here because an archived page
  // body can contain a forged numbered link. Re-fetch each candidate and run
  // the current substantive + relevance selector before admitting any URL.
  const candidates = extractLegacyPostRepairEvidence(post.rawItem.markdown);
  if (post.sourceUrl && /^https?:\/\//i.test(post.sourceUrl)) {
    const key = normalizeUrl(post.sourceUrl);
    if (key && !candidates.some((item) => normalizeUrl(item.url) === key)) {
      candidates.push({
        title: post.title,
        url: post.sourceUrl,
        sourceName: "管理员指定来源",
        summary: post.title,
        materialKind: "excerpt"
      });
    }
  }
  if (!candidates.length) {
    return {
      ok: false,
      reason: "历史草稿没有可重新抓取的来源地址；请补充正文来源后重跑原生成任务"
    };
  }

  let transientFailures = 0;
  const revalidated = await revalidateArchivedEvidence(candidates, 8, () => { transientFailures += 1; });
  const keyword = researchKeywordForPost(post);
  const selected = /^https?:\/\//i.test(post.rawItem.url)
    ? revalidated
    : selectWritingEvidence(revalidated, keyword);
  const sufficiency = assessEvidenceSufficiency(selected, evidencePolicyForPost(post, selected.length));
  if (!sufficiency.ok) {
    const transientNote = transientFailures
      ? `；另有 ${transientFailures} 个来源本轮暂时无法抓取，可稍后重试`
      : "";
    return {
      ok: false,
      reason: `旧资料已按当前规则重新抓取和核验，但仍不足以安全返修：${sufficiency.reason}${transientNote}`
    };
  }

  const upgradedMarkdown = /^https?:\/\//i.test(post.rawItem.url)
    ? null
    : buildTrustedResearchInventoryUpgrade({
      markdown: post.rawItem.markdown,
      trustedEvidence: selected,
      allEvidence: revalidated
    });
  return {
    ok: true,
    value: {
      evidence: selected,
      allowedSourceUrls: uniqueEvidenceUrls(selected),
      upgradedMarkdown: upgradedMarkdown !== post.rawItem.markdown ? upgradedMarkdown : null
    }
  };
}

function researchKeywordForPost(post: NonNullable<PostSnapshot>) {
  const fetchSourceUrl = post.rawItem?.fetchJob?.sourceUrl || "";
  try {
    const parsed = parseKeywordResearchUrl(fetchSourceUrl);
    if (parsed?.keyword) return parsed.keyword;
  } catch {
    // Fall through to the persisted artifact title.
  }
  return (post.rawItem?.title || post.title)
    .replace(/^(?:关键词研究|每日要闻|周报综述)\s*[：:]\s*/i, "")
    .trim();
}

function evidencePolicyForPost(post: NonNullable<PostSnapshot>, itemCount: number) {
  const depth = researchDepthForPost(post);
  if (depth === "deep") {
    return { minItems: 3, minTotalInformationChars: 2200, strongSingleItemChars: null, minFullTextItems: 3 };
  }
  if (depth === "standard") {
    return { minItems: 2, minTotalInformationChars: 700, strongSingleItemChars: 900, minFullTextItems: 1 };
  }
  if (depth === "long" || (post.rawItem?.url || "").startsWith("keyword://")) {
    return { minItems: 2, minTotalInformationChars: 1200, strongSingleItemChars: null, minFullTextItems: 2 };
  }
  if ((post.rawItem?.url || "").startsWith("digest://")) {
    return { minItems: 3, minTotalInformationChars: 1100, strongSingleItemChars: null, minFullTextItems: 3 };
  }
  return {
    minItems: itemCount === 1 ? 1 : 2,
    minTotalInformationChars: itemCount === 1 ? 500 : 800,
    strongSingleItemChars: itemCount === 1 ? 500 : 900,
    minFullTextItems: 1
  };
}

function researchDepthForPost(post: NonNullable<PostSnapshot>): ResearchDepth | null {
  const persisted = post.rawItem?.markdown.match(/^深度：\s*(standard|long|deep)\s*$/im)?.[1];
  if (persisted === "standard" || persisted === "long" || persisted === "deep") return persisted;
  try {
    return parseKeywordResearchUrl(post.rawItem?.fetchJob?.sourceUrl || "")?.depth || null;
  } catch {
    return null;
  }
}

function uniqueEvidenceUrls(evidence: EvidenceItem[]) {
  const seen = new Set<string>();
  return evidence.map((item) => item.url).filter((url) => {
    const key = normalizeUrl(url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function persistEvidenceUpgrade(
  fetchJobId: string,
  snapshot: NonNullable<PostSnapshot>,
  request: PostRepairRequest,
  upgradedMarkdown: string
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Post" WHERE "id" = ${snapshot.id} FOR UPDATE`);
    if (!snapshot.rawItemId) throw new Error("原始研究条目已被删除，可信来源升级已取消");
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "RawItem" WHERE "id" = ${snapshot.rawItemId} FOR UPDATE`);
    const current = await tx.post.findUnique({
      where: { id: snapshot.id },
      select: {
        updatedAt: true,
        status: true,
        pendingRevision: true,
        rawItem: {
          select: {
            id: true,
            title: true,
            url: true,
            content: true,
            markdown: true,
            artifactKind: true,
            fetchJob: { select: { sourceType: true, sourceUrl: true } }
          }
        }
      }
    });
    if (!current || current.updatedAt.getTime() !== request.expectedUpdatedAt.getTime() || current.status !== "DRAFT") {
      throw new Error("重建来源期间文章已被修改，AI 已停止以免覆盖管理员的新版本");
    }
    if (current.pendingRevision !== null || !current.rawItem) {
      throw new Error("重建来源期间文章或待审版本发生变化，AI 已安全停止");
    }
    const oldRevision = postRepairEvidenceRevision({
      rawItemId: current.rawItem.id,
      title: current.rawItem.title,
      url: current.rawItem.url,
      content: current.rawItem.content,
      markdown: current.rawItem.markdown,
      artifactKind: current.rawItem.artifactKind,
      sourceType: current.rawItem.fetchJob?.sourceType,
      fetchSourceUrl: current.rawItem.fetchJob?.sourceUrl
    });
    if (oldRevision !== request.evidenceRevision) {
      throw new Error("重建来源期间原始资料发生变化，必须基于最新版本重新审核");
    }

    const newRevision = postRepairEvidenceRevision({
      rawItemId: current.rawItem.id,
      title: current.rawItem.title,
      url: current.rawItem.url,
      content: current.rawItem.content,
      markdown: upgradedMarkdown,
      artifactKind: current.rawItem.artifactKind,
      sourceType: current.rawItem.fetchJob?.sourceType,
      fetchSourceUrl: current.rawItem.fetchJob?.sourceUrl
    });
    await tx.rawItem.update({ where: { id: current.rawItem.id }, data: { markdown: upgradedMarkdown } });
    const job = await tx.fetchJob.updateMany({
      where: { id: fetchJobId, status: "RUNNING" },
      data: {
        sourceUrl: buildPostRepairUrl({
          postId: snapshot.id,
          expectedUpdatedAt: request.expectedUpdatedAt,
          evidenceRevision: newRevision
        })
      }
    });
    if (job.count !== 1) throw new Error("返修任务状态已变化，可信来源升级已取消");
    return newRevision;
  }, { timeout: 15_000 });
}

async function postVideoIntegrityReason(postId: string, content: string) {
  const ids = [...new Set([...content.matchAll(/\[\[video:([^\]\r\n]+)]]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean))];
  if (!ids.length) return null;
  const owned = await prisma.video.count({ where: { id: { in: ids }, postId } });
  return owned === ids.length
    ? null
    : "原稿包含不属于该文章或已经失效的视频挂载点，AI 不会带着未授权媒体继续发布；请先在编辑器中修正视频";
}

async function regenerateFromEvidence(input: {
  post: NonNullable<PostSnapshot>;
  evidence: EvidenceItem[];
  modelConfig: ModelConfig;
  style: ContentStyle;
}) {
  if (input.evidence.length === 1) {
    const item = input.evidence[0];
    return generateSummary({
      modelConfig: input.modelConfig,
      style: input.style,
      item: {
        title: item.title,
        url: item.url,
        markdown: item.summary,
        publishedAt: item.publishedAt
      }
    });
  }
  const keyword = (input.post.rawItem?.title || input.post.title)
    .replace(/^(?:关键词研究|每日要闻|周报综述)\s*[：:]\s*/i, "")
    .trim();
  const scopeLabel = input.post.rawItem?.markdown.match(/^范围：\s*(.+?)\s*$/m)?.[1] || "原研究范围";
  const persistedDepth = researchDepthForPost(input.post);
  return generateContentArticle({
    modelConfig: input.modelConfig,
    style: input.style,
    keyword,
    scopeLabel,
    articleIndex: 1,
    articleCount: 1,
    depth: persistedDepth || (input.post.rawItem?.url.startsWith("keyword://") ? "long" : input.style.length === "长" ? "long" : "standard"),
    evidence: input.evidence
  });
}

async function publishCandidate(
  fetchJobId: string,
  snapshot: NonNullable<PostSnapshot>,
  request: PostRepairRequest,
  draft: PostRepairDraft,
  generatedArtifact: boolean,
  resolvedEvidence: ResolvedPostRepairEvidence,
  successResult: PostRepairResult
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Post" WHERE "id" = ${snapshot.id} FOR UPDATE`);
    if (snapshot.rawItemId) {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "RawItem" WHERE "id" = ${snapshot.rawItemId} FOR UPDATE`);
    }
    const current = await tx.post.findUnique({
      where: { id: snapshot.id },
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        content: true,
        sourceUrl: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        rawItemId: true,
        publicationBlockedReason: true,
        pendingRevision: true,
        rawItem: {
          select: {
            id: true,
            title: true,
            url: true,
            content: true,
            markdown: true,
            artifactKind: true,
            fetchJob: { select: { sourceType: true, sourceUrl: true } }
          }
        }
      }
    });
    if (!current || current.updatedAt.getTime() !== request.expectedUpdatedAt.getTime()) {
      throw new Error("返修期间文章已被修改，候选稿未覆盖管理员的新版本");
    }
    if (current.status !== "DRAFT") {
      throw new Error("返修期间文章状态已变化，候选稿未自动发布");
    }
    if (current.pendingRevision !== null) {
      throw new Error("返修期间出现了待审核修改，候选稿未自动发布");
    }
    if (evidenceRevisionForPost(current) !== request.evidenceRevision) {
      throw new Error("返修期间原始来源发生变化，候选稿必须重新审核");
    }
    const finalAssessment = assessPostPublicationRequest({
      requestedStatus: "PUBLISHED",
      publicationBlockedReason: current.publicationBlockedReason,
      title: draft.title,
      summary: draft.summary,
      content: draft.content,
      generatedArtifact,
      allowedSourceUrls: resolvedEvidence.allowedSourceUrls
    });
    if (!finalAssessment.ok) {
      throw new Error(`最终发布检查仍未通过：${finalAssessment.reason}`);
    }
    const videoIds = [...new Set([...draft.content.matchAll(/\[\[video:([^\]\r\n]+)]]/g)]
      .map((match) => match[1].trim())
      .filter(Boolean))];
    if (videoIds.length) {
      const ownedVideos = await tx.video.count({ where: { id: { in: videoIds }, postId: current.id } });
      if (ownedVideos !== videoIds.length) {
        throw new Error("最终发布检查发现视频关联已经变化，候选稿未自动发布");
      }
    }
    if (resolvedEvidence.upgradedMarkdown && current.rawItemId) {
      await tx.rawItem.update({
        where: { id: current.rawItemId },
        data: { markdown: resolvedEvidence.upgradedMarkdown }
      });
    }
    const contentChanged = draft.title !== current.title || draft.summary !== current.summary || draft.content !== current.content;
    await tx.post.update({
      where: { id: current.id },
      data: {
        title: draft.title,
        summary: draft.summary,
        content: draft.content,
        status: "PUBLISHED",
        publishedAt: current.publishedAt || new Date(),
        publicationBlockedReason: null,
        ...(contentChanged ? {
          titleEn: null,
          summaryEn: null,
          contentEn: null,
          translatedAt: null
        } : {})
      }
    });
    // Publish state and its structured audit result commit together. If the
    // worker dies immediately afterwards, the batch cannot report a published
    // article as a failed draft.
    const completedJob = await tx.fetchJob.updateMany({
      where: { id: fetchJobId, status: "RUNNING" },
      data: {
        status: "COMPLETED",
        error: encodePostRepairResult(successResult),
        completedAt: new Date()
      }
    });
    if (completedJob.count !== 1) {
      throw new Error("返修任务状态已变化，发布事务已安全取消");
    }
    return current.slug;
  }, { timeout: 15_000 });
}

async function failRepair(
  fetchJobId: string,
  post: NonNullable<PostSnapshot>,
  reason: string,
  attempts: number,
  rounds: PostRepairRound[]
): Promise<never> {
  const result = resultForFailure(post.id, post.title, reason, attempts, rounds);
  await writeRepairResult(fetchJobId, result);
  // Failure details live on the immutable task audit. Never mutate Post here:
  // a conflict is itself a failure mode, and touching even its block reason
  // could overwrite an administrator's newer revision.
  throwRepairFailure(result);
}

function throwRepairFailure(result: PostRepairResult): never {
  throw new UnpublishableGeneratedArticleError(encodePostRepairResult(result));
}

async function writeRepairResult(fetchJobId: string, result: PostRepairResult) {
  const updated = await prisma.fetchJob.updateMany({
    where: { id: fetchJobId, status: "RUNNING" },
    data: { error: encodePostRepairResult(result) }
  });
  if (updated.count === 1) return;
  const current = await prisma.fetchJob.findUnique({ where: { id: fetchJobId }, select: { status: true } });
  if (current?.status === "COMPLETED") return;
  throw new Error("返修任务状态已变化，已停止写入过期的审核结果");
}

function baseResult(postId: string, title: string, state: PostRepairResult["state"], message: string): PostRepairResult {
  return {
    version: 1,
    postId,
    title,
    state,
    attempts: 0,
    maxAttempts: POST_REPAIR_MAX_ATTEMPTS,
    message,
    reason: null,
    guidance: null,
    rounds: []
  };
}

function resultForFailure(
  postId: string,
  title: string,
  reason: string,
  attempts: number,
  rounds: PostRepairRound[]
): PostRepairResult {
  return {
    ...baseResult(postId, title, "FAILED", attempts
      ? `已执行 ${attempts} 轮返修，仍未通过；原稿保持为草稿`
      : "当前问题不能靠文字返修安全解决；原稿保持不变"),
    attempts,
    reason,
    guidance: postRepairGuidance(reason),
    rounds
  };
}

function outputTokenTarget(length: string) {
  return length === "长" ? 4200 : length === "短" ? 3000 : 3600;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
