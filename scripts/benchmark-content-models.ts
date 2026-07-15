import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { ContentStyle, ModelConfig } from "@prisma/client";
import {
  generateContentArticle,
  isInsufficientEvidenceOutput,
  ModelRequestError,
  repairUnpublishableArticle,
  type EvidenceItem,
  type StyleConfig
} from "../src/lib/ai";
import { normalizeContentMode } from "../src/lib/content-style";
import { decryptSecret } from "../src/lib/crypto";
import { extractTrustedEvidenceManifest } from "../src/lib/post-repair";
import { prisma } from "../src/lib/prisma";
import { parseKeywordResearchUrl, researchScopeLabel, type ResearchDepth } from "../src/lib/research";
import {
  assessEvidenceSufficiency,
  assessGeneratedArticle,
  normalizeUrl
} from "../src/lib/source-quality";
import { selectWritingEvidence } from "../src/worker/evidence";
import { assessEvidenceClaimConsistency } from "../src/lib/evidence-claim-consistency";
import { POST_REPAIR_MAX_ATTEMPTS, runPostRepairRounds } from "../src/lib/post-repair";

type Candidate = {
  configId: string;
  configName: string;
  provider: string;
  endpointHost: string;
  model: string;
  modelConfig: ModelConfig;
};

type CliOptions = {
  rawItemId: string;
  candidates: Array<{ selector: string; model: string }>;
  execute: boolean;
  includeContent: boolean;
  maximumTokens: number;
  repetitions: number;
};

type CitationMetrics = {
  informationChars: number;
  sectionHeadings: number;
  inlineLinks: number;
  distinctInlineSources: number;
  referenceLinks: number;
  distinctReferenceSources: number;
  outsideAllowedUrls: string[];
  contentSha256: string;
};

export type BenchmarkEvidencePlan = {
  source: "trusted-manifest" | "legacy-dry-run";
  evidence: EvidenceItem[];
  executionEligible: boolean;
  warning: string | null;
};

type BenchmarkResult = {
  configId: string;
  configName: string;
  provider: string;
  endpointHost: string;
  model: string;
  repetition: number;
  status: "publishable" | "unpublishable" | "model_error" | "unexpected_error";
  truncated: boolean;
  totalMs: number;
  generationAndReviewMs?: number;
  repairMs?: number;
  repairAttempts?: number;
  initialGate?: { ok: boolean; reason?: string };
  repairAttempted?: boolean;
  finalGate?: { ok: boolean; reason?: string };
  citations?: CitationMetrics;
  error?: string;
  content?: string;
};

type BenchmarkAggregate = ReturnType<typeof aggregateCandidateRuns>;

const DEFAULT_MAXIMUM_TOKENS = 4200;

/**
 * Reconstruct the archived EvidenceItem array written by createDraftFromResearch.
 *
 * Older RawItem rows kept complete evidence bodies in `content`, while `markdown`
 * kept their ordered titles, URLs, publishers and dates. Material-kind metadata was
 * not persisted, so archived rows are classified conservatively: only bodies with
 * at least 900 information characters are marked fulltext. This is the legacy-row
 * compatibility threshold used by the publication gate, and avoids upgrading a
 * 140-character search summary into evidence. The normal topic-anchor filter then
 * removes unrelated long pages and short search snippets before model invocation.
 */
export function reconstructArchivedResearchEvidence(content: string, markdown: string): EvidenceItem[] {
  const metadata = [...markdown.matchAll(
    /^\d+\. \[([^\]\r\n]+)]\((https?:\/\/[^\s)]+)\)\r?\n\s+- 来源：([^\r\n]+)(?:\r?\n\s+- 时间：([^\r\n]+))?/gm
  )].map((match) => ({
    title: match[1].trim(),
    url: match[2].trim(),
    sourceName: match[3].trim(),
    publishedAt: parseOptionalDate(match[4])
  }));

  let cursor = 0;
  return metadata.map((item, index) => {
    const marker = `${item.title}\n`;
    const start = content.indexOf(marker, cursor);
    const nextMarker = metadata[index + 1] ? `\n\n${metadata[index + 1].title}\n` : "";
    const next = start >= 0 && nextMarker ? content.indexOf(nextMarker, start + marker.length) : -1;
    const summary = start >= 0
      ? content.slice(start + marker.length, next >= 0 ? next : undefined).trim()
      : archivedMarkdownExcerpt(markdown, item.title);
    cursor = next >= 0 ? next + 2 : content.length;
    return {
      ...item,
      summary,
      materialKind: informationLength(summary) >= 900 ? "fulltext" as const : "excerpt" as const
    };
  });
}

/**
 * Resolve the immutable evidence set shared by every candidate model.
 *
 * A trusted manifest is the only archived source allowed to cross into paid
 * execution. Legacy inventories remain visible in dry-run audits so operators
 * can inspect old rows, but their human-readable Markdown is not a trust
 * boundary and therefore cannot support a model-quality conclusion.
 */
export function resolveBenchmarkEvidence(input: {
  content: string;
  markdown: string;
  execute: boolean;
}): BenchmarkEvidencePlan {
  const trustedEvidence = extractTrustedEvidenceManifest(input.markdown);
  if (trustedEvidence.length) {
    return {
      source: "trusted-manifest",
      evidence: trustedEvidence,
      executionEligible: true,
      warning: null
    };
  }

  if (input.execute) {
    throw new Error(
      "该 RawItem 没有有效的可信证据清单，拒绝启动付费模型请求。请先重跑研究或通过 AI 返修流程重新抓取并升级来源。"
    );
  }

  return {
    source: "legacy-dry-run",
    evidence: reconstructArchivedResearchEvidence(input.content, input.markdown),
    executionEligible: false,
    warning: "当前仅为旧归档资料的兼容预览；未重新抓取并生成可信证据清单前，不可执行模型对比。"
  };
}

export function measureArticleCitations(
  markdown: string,
  allowedSourceUrls: string[]
): CitationMetrics {
  const referencesMatch = markdown.match(/^##\s*参考来源\s*$/im);
  const body = referencesMatch?.index === undefined ? markdown : markdown.slice(0, referencesMatch.index);
  const references = referencesMatch?.index === undefined
    ? ""
    : markdown.slice(referencesMatch.index + referencesMatch[0].length);
  const bodyUrls = extractHttpUrls(body);
  const referenceUrls = extractHttpUrls(references);
  const allowed = new Set(allowedSourceUrls.map(normalizeUrl).filter(Boolean));
  const outsideAllowedUrls = [...new Set(extractHttpUrls(markdown)
    .filter((url) => !allowed.has(normalizeUrl(url))))];

  return {
    informationChars: informationLength(stripMarkdown(markdown)),
    sectionHeadings: body.match(/^##\s+\S+/gm)?.length || 0,
    inlineLinks: bodyUrls.length,
    distinctInlineSources: new Set(bodyUrls.map(normalizeUrl).filter(Boolean)).size,
    referenceLinks: referenceUrls.length,
    distinctReferenceSources: new Set(referenceUrls.map(normalizeUrl).filter(Boolean)).size,
    outsideAllowedUrls,
    contentSha256: createHash("sha256").update(markdown).digest("hex")
  };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const rawItem = await prisma.rawItem.findUnique({
    where: { id: options.rawItemId },
    select: {
      id: true,
      content: true,
      markdown: true,
      fetchJob: {
        select: {
          sourceUrl: true,
          contentStyleId: true
        }
      }
    }
  });
  if (!rawItem?.fetchJob) throw new Error(`找不到带 FetchJob 的原始研究条目：${options.rawItemId}`);

  const research = parseKeywordResearchUrl(rawItem.fetchJob.sourceUrl);
  if (!research) throw new Error("该 RawItem 不是关键词研究任务，无法复用关键词、范围和深度。 ");
  const evidencePlan = resolveBenchmarkEvidence({
    content: rawItem.content,
    markdown: rawItem.markdown,
    execute: options.execute
  });
  const allEvidence = evidencePlan.evidence;
  const writingEvidence = selectWritingEvidence(allEvidence, research.keyword);
  const evidenceGate = assessEvidenceSufficiency(writingEvidence, evidencePolicyForDepth(research.depth));
  const style = await loadStyle(rawItem.fetchJob.contentStyleId);
  const savedConfigs = await prisma.modelConfig.findMany({ orderBy: { createdAt: "asc" } });
  const candidates = resolveCandidates(options.candidates, savedConfigs, options.maximumTokens);

  const audit = {
    benchmarkVersion: 1,
    mode: options.execute ? "execute" : "dry-run",
    startedAt: new Date().toISOString(),
    rawItemId: rawItem.id,
    keyword: research.keyword,
    scope: research.scope,
    depth: research.depth,
    style: {
      id: style.id,
      name: style.name,
      contentMode: style.contentMode,
      length: style.length
    },
    evidenceGate,
    evidence: {
      source: evidencePlan.source,
      executionEligible: evidencePlan.executionEligible,
      warning: evidencePlan.warning,
      availableCount: allEvidence.length,
      writingCount: writingEvidence.length,
      selected: writingEvidence.map((item) => ({
        title: item.title,
        sourceName: item.sourceName,
        url: item.url,
        informationChars: informationLength(item.summary)
      }))
    },
    requestPolicy: {
      temperature: 0.2,
      maximumTokens: options.maximumTokens,
      samePrompt: true,
      draftThenFactReview: true,
      deterministicPublicationGate: true,
      targetedRepairAfterGateFailure: true,
      maximumTargetedRepairRounds: POST_REPAIR_MAX_ATTEMPTS,
      repetitionsPerCandidate: options.repetitions,
      databaseWrites: false
    },
    candidates: candidates.map(publicCandidate)
  };

  if (!options.execute) {
    const hint = evidencePlan.executionEligible
      ? "Add --execute to call the models; no database rows will be written."
      : "Legacy evidence is preview-only. Re-run research or AI repair to create a trusted manifest before using --execute.";
    console.log(JSON.stringify({ ...audit, hint }, null, 2));
    return;
  }
  if (!evidenceGate.ok) throw new Error(`证据门禁未通过，拒绝启动付费模型请求：${evidenceGate.reason}`);
  if (candidates.length < 2) throw new Error("执行对比至少需要两个 --candidate。 ");

  const secrets = candidates.map((candidate) => decryptSecret(candidate.modelConfig.apiKeyEnc));
  const runs: BenchmarkResult[] = [];
  for (const candidate of candidates) {
    for (let repetition = 1; repetition <= options.repetitions; repetition++) {
      console.error(`[benchmark] ${candidate.model} run ${repetition}/${options.repetitions}: draft + review started`);
      const run = await benchmarkCandidate({
        candidate,
        repetition,
        style,
        keyword: research.keyword,
        scopeLabel: researchScopeLabel(research.scope),
        depth: research.depth,
        evidence: writingEvidence,
        includeContent: options.includeContent,
        secrets
      });
      runs.push(run);
      console.error(`[benchmark] ${candidate.model} run ${repetition}/${options.repetitions}: ${run.status} in ${run.totalMs}ms`);
    }
  }
  const aggregates: BenchmarkAggregate[] = candidates.map((candidate) =>
    aggregateCandidateRuns(candidate, runs.filter((run) =>
      run.configId === candidate.configId && run.model === candidate.model
    ))
  );

  console.log(JSON.stringify({
    ...audit,
    completedAt: new Date().toISOString(),
    aggregates,
    runs
  }, null, 2));
}

async function benchmarkCandidate(input: {
  candidate: Candidate;
  repetition: number;
  style: ContentStyle;
  keyword: string;
  scopeLabel: string;
  depth: ResearchDepth;
  evidence: EvidenceItem[];
  includeContent: boolean;
  secrets: string[];
}): Promise<BenchmarkResult> {
  const started = Date.now();
  const base = publicCandidate(input.candidate);
  const allowedSourceUrls = input.evidence.map((item) => item.url);
  const gateOptions = {
    allowedSourceUrls,
    requireInlineCitation: true,
    requireSectionHeadings: requiresSectionHeadings(input.style),
    minimumDistinctInlineSources: Math.min(2, new Set(allowedSourceUrls.map(normalizeUrl)).size),
    minimumBodyInformationChars: minimumGeneratedBodyChars(input.style)
  };
  const assess = (article: string) => {
    const claimAssessment = assessEvidenceClaimConsistency(article, input.evidence);
    return claimAssessment.ok ? assessGeneratedArticle(article, gateOptions) : claimAssessment;
  };

  try {
    const generationStarted = Date.now();
    let article = await generateContentArticle({
      modelConfig: input.candidate.modelConfig,
      style: input.style as StyleConfig,
      keyword: input.keyword,
      scopeLabel: input.scopeLabel,
      articleIndex: 1,
      articleCount: 1,
      depth: input.depth,
      evidence: input.evidence
    });
    const generationAndReviewMs = Date.now() - generationStarted;
    console.error(`[benchmark] ${input.candidate.model} run ${input.repetition}: draft + review completed in ${generationAndReviewMs}ms`);
    const initial = assess(article);
    let final = initial;
    let repairAttempted = false;
    let repairMs: number | undefined;
    let repairAttempts = 0;

    if (!initial.ok && !isInsufficientEvidenceOutput(article)) {
      repairAttempted = true;
      console.error(`[benchmark] ${input.candidate.model} run ${input.repetition}: up to ${POST_REPAIR_MAX_ATTEMPTS} targeted repairs started (${initial.reason})`);
      const repairStarted = Date.now();
      const loop = await runPostRepairRounds({
        initialDraft: { title: "", summary: "", content: article },
        maxAttempts: POST_REPAIR_MAX_ATTEMPTS,
        assess: (draft) => assess(draft.content),
        revise: async (draft, reason, round) => {
          const content = await repairUnpublishableArticle({
            modelConfig: input.candidate.modelConfig,
            article: draft.content,
            gateReason: reason,
            allowedUrls: allowedSourceUrls,
            evidence: input.evidence,
            minimumOutputTokens: input.depth === "deep" ? 6000 : input.depth === "long" ? 4200 : 3000,
            repairRound: round,
            maxRepairRounds: POST_REPAIR_MAX_ATTEMPTS
          });
          if (isInsufficientEvidenceOutput(content)) {
            return {
              draft: { ...draft, content },
              action: "repair" as const,
              stopReason: content
            };
          }
          return { draft: { ...draft, content }, action: "repair" as const };
        }
      });
      repairMs = Date.now() - repairStarted;
      repairAttempts = loop.attempts;
      article = loop.draft.content;
      final = assess(article);
    }

    return {
      ...base,
      repetition: input.repetition,
      status: final.ok ? "publishable" : "unpublishable",
      truncated: false,
      totalMs: Date.now() - started,
      generationAndReviewMs,
      repairMs,
      repairAttempts,
      initialGate: assessmentForJson(initial),
      repairAttempted,
      finalGate: assessmentForJson(final),
      citations: measureArticleCitations(article, allowedSourceUrls),
      ...(input.includeContent ? { content: article } : {})
    };
  } catch (error) {
    const isModelError = error instanceof ModelRequestError;
    return {
      ...base,
      repetition: input.repetition,
      status: isModelError ? "model_error" : "unexpected_error",
      truncated: isModelError && error.truncated,
      totalMs: Date.now() - started,
      error: redactSecrets(error instanceof Error ? `${error.name}: ${error.message}` : String(error), input.secrets)
    };
  }
}

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    rawItemId: "",
    candidates: [],
    execute: false,
    includeContent: false,
    maximumTokens: DEFAULT_MAXIMUM_TOKENS,
    repetitions: 2
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--include-content") options.includeContent = true;
    else if (arg === "--raw-item") options.rawItemId = requiredValue(argv, ++index, arg);
    else if (arg === "--candidate") {
      const value = requiredValue(argv, ++index, arg);
      const separator = value.indexOf("::");
      if (separator < 1 || separator === value.length - 2) {
        throw new Error("--candidate 格式应为 <配置 ID 或精确名称>::<模型 ID>");
      }
      options.candidates.push({ selector: value.slice(0, separator), model: value.slice(separator + 2) });
    } else if (arg === "--maximum-tokens") {
      options.maximumTokens = Number(requiredValue(argv, ++index, arg));
    } else if (arg === "--repetitions") {
      options.repetitions = Number(requiredValue(argv, ++index, arg));
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!options.rawItemId) throw new Error("必须提供 --raw-item。 ");
  if (!Number.isInteger(options.maximumTokens) || options.maximumTokens < 1000 || options.maximumTokens > 16000) {
    throw new Error("--maximum-tokens 必须是 1000—16000 之间的整数。 ");
  }
  if (!Number.isInteger(options.repetitions) || options.repetitions < 2 || options.repetitions > 5) {
    throw new Error("--repetitions 必须是 2—5 之间的整数；内容模型不能只测一次。 ");
  }
  return options;
}

function resolveCandidates(
  specs: CliOptions["candidates"],
  configs: ModelConfig[],
  maximumTokens: number
): Candidate[] {
  const effective = specs.length
    ? specs
    : configs.map((config) => ({ selector: config.id, model: config.model }));
  const seen = new Set<string>();
  return effective.map((spec) => {
    const matches = configs.filter((config) => config.id === spec.selector || config.name === spec.selector);
    if (matches.length !== 1) throw new Error(`模型配置选择器必须精确匹配一项：${spec.selector}`);
    const config = matches[0];
    if (!spec.model.trim() || /\s/.test(spec.model)) throw new Error(`模型 ID 无效：${spec.model}`);
    const key = `${config.id}\n${spec.model}`;
    if (seen.has(key)) throw new Error(`候选模型重复：${spec.model}`);
    seen.add(key);
    let endpointHost = "invalid-url";
    try { endpointHost = new URL(config.baseUrl).host; } catch { /* request layer will reject it */ }
    return {
      configId: config.id,
      configName: config.name,
      provider: config.provider,
      endpointHost,
      model: spec.model,
      modelConfig: {
        ...config,
        model: spec.model,
        temperature: 0.2,
        maxTokens: maximumTokens
      }
    };
  });
}

async function loadStyle(id: string | null): Promise<ContentStyle> {
  const style = id
    ? await prisma.contentStyle.findUnique({ where: { id } })
    : await prisma.contentStyle.findFirst({ orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] });
  if (!style) throw new Error("找不到内容风格配置。 ");
  return style;
}

function evidencePolicyForDepth(depth: ResearchDepth) {
  if (depth === "deep") {
    return { minItems: 3, minTotalInformationChars: 2200, strongSingleItemChars: null, minFullTextItems: 3 };
  }
  if (depth === "standard") {
    return { minItems: 2, minTotalInformationChars: 700, strongSingleItemChars: 900, minFullTextItems: 1 };
  }
  return { minItems: 2, minTotalInformationChars: 1200, strongSingleItemChars: null, minFullTextItems: 2 };
}

function requiresSectionHeadings(style: Pick<ContentStyle, "contentMode" | "length">) {
  const mode = normalizeContentMode(style.contentMode);
  return style.length !== "短" && mode !== "essay" && mode !== "opinion";
}

function minimumGeneratedBodyChars(style: Pick<ContentStyle, "contentMode" | "length">) {
  const mode = normalizeContentMode(style.contentMode);
  return style.length === "短" || mode === "opinion" || mode === "essay" ? 180 : 350;
}

function assessmentForJson(assessment: ReturnType<typeof assessGeneratedArticle>) {
  return assessment.ok ? { ok: true } : { ok: false, reason: assessment.reason };
}

function aggregateCandidateRuns(candidate: Candidate, runs: BenchmarkResult[]) {
  const publishable = runs.filter((run) => run.status === "publishable").length;
  const unpublishable = runs.filter((run) => run.status === "unpublishable").length;
  const modelErrors = runs.filter((run) => run.status === "model_error").length;
  const unexpectedErrors = runs.filter((run) => run.status === "unexpected_error").length;
  const elapsed = runs.map((run) => run.totalMs).sort((a, b) => a - b);
  const gateReasons = new Map<string, number>();
  for (const run of runs) {
    const reason = run.finalGate?.ok === false
      ? run.finalGate.reason || "unknown gate reason"
      : run.error;
    if (reason) gateReasons.set(reason, (gateReasons.get(reason) || 0) + 1);
  }
  return {
    ...publicCandidate(candidate),
    repetitions: runs.length,
    publishableRuns: publishable,
    publishableRate: runs.length ? Number((publishable / runs.length).toFixed(3)) : 0,
    unpublishableRuns: unpublishable,
    modelErrorRuns: modelErrors,
    unexpectedErrorRuns: unexpectedErrors,
    truncatedRuns: runs.filter((run) => run.truncated).length,
    repairAttemptedRuns: runs.filter((run) => run.repairAttempted).length,
    latencyMs: {
      minimum: elapsed[0] || 0,
      average: elapsed.length ? Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length) : 0,
      maximum: elapsed.at(-1) || 0
    },
    distinctOutputHashes: new Set(
      runs.map((run) => run.citations?.contentSha256).filter((hash): hash is string => Boolean(hash))
    ).size,
    gateOrErrorReasons: [...gateReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
  };
}

function publicCandidate(candidate: Candidate) {
  return {
    configId: candidate.configId,
    configName: candidate.configName,
    provider: candidate.provider,
    endpointHost: candidate.endpointHost,
    model: candidate.model
  };
}

function archivedMarkdownExcerpt(markdown: string, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.match(new RegExp(`^\\d+\\. \\[[^\\]]+]\\([^\\n]+\\)[\\s\\S]*?^\\s+- 摘录：([^\\n]*)`, "m"))?.[1]?.trim()
    || markdown.match(new RegExp(`${escaped}[\\s\\S]{0,800}`))?.[0]?.trim()
    || "";
}

function parseOptionalDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value.trim());
  return Number.isFinite(date.getTime()) ? date : null;
}

function extractHttpUrls(value: string) {
  const urls: string[] = [];
  let remaining = value.replace(
    /\[[^\]]*]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+?)\)/gi,
    (match, url: string) => {
      urls.push(url);
      return " ".repeat(match.length);
    }
  );
  remaining = remaining.replace(/<(https?:\/\/[^<>\s]+)>/gi, (match, url: string) => {
    urls.push(url);
    return " ".repeat(match.length);
  });
  for (const match of remaining.matchAll(/https?:\/\/[^\s<>"'`“”‘’，。；：！？、（）［］｛｝【】《》「」]+/gi)) {
    urls.push(trimBareUrlPunctuation(match[0]));
  }
  return urls.filter(Boolean);
}

function trimBareUrlPunctuation(value: string) {
  let url = value.replace(/[.,;:!?]+$/g, "");
  const pairs: Array<[string, string]> = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) {
    while (url.endsWith(close) && countCharacter(url, close) > countCharacter(url, open)) {
      url = url.slice(0, -1);
    }
  }
  return url;
}

function countCharacter(value: string, character: string) {
  return [...value].filter((item) => item === character).length;
}

function stripMarkdown(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`~#-]+/g, " ");
}

function informationLength(value: string) {
  return value.match(/[\p{L}\p{N}]/gu)?.length || 0;
}

function redactSecrets(value: string, secrets: string[]) {
  let output = value;
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .slice(0, 800);
}

function requiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} 缺少值。`);
  return value;
}

function printHelp() {
  console.log([
    "Usage:",
    "  tsx scripts/benchmark-content-models.ts --raw-item <id> [options]",
    "",
    "Options:",
    "  --candidate '<config id or exact name>::<model id>'  Repeat for each model.",
    "  --maximum-tokens <1000-16000>                     Same output budget for every model (default 4200).",
    "  --repetitions <2-5>                                Runs per model (default 2; one-shot tests are rejected).",
    "  --execute                                         Make model API calls; still performs no database writes.",
    "  --include-content                                 Include complete generated Markdown in JSON output.",
    "",
    "Without --execute the command only prints the evidence/model audit plan."
  ].join("\n"));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
