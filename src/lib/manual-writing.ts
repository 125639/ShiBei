import { z } from "zod";
import {
  MAX_SCORABLE_WORK_CONTENT_LENGTH,
  MAX_WRITING_DOC_CONTENT_LENGTH
} from "./creation-limits";

export type ManualWritingDepth = "SHORT" | "FULL";

export const ManualCommunityDraftSchema = z.object({
  genreId: z.string().min(1, "请选择题材"),
  depth: z.enum(["SHORT", "FULL"]),
  // 用户在“完成预览”里实际确认过的服务端版本；不能在点击交接时悄悄换成
  // 另一个标签页刚保存、但当前用户从未预览确认的新正文。
  expectedUpdatedAt: z.string().datetime()
});

export type ManualWritingDocument = {
  id: string;
  title: string;
  content: string;
  ownerId: string | null;
  anonId: string | null;
  creativeWorkId: string | null;
  publicationBlockedAt: Date | null;
};

export type ManualWorkRecord = {
  id: string;
  mode: "MANUAL" | "VOICE_FIRST" | "AI_FIRST";
  status: "INTERVIEWING" | "DRAFT" | "SHARED";
  slug: string | null;
};

export type ManualWorkCreateInput = {
  ownerId: string | null;
  anonId: string | null;
  clientIp: string | null;
  genreId: string;
  mode: "MANUAL";
  depth: ManualWritingDepth;
  status: "DRAFT";
  topic: string;
  interview: "[]";
  pendingQuestion: null;
  title: string;
  summary: string;
  content: string;
  draftGeneratedAt: null;
};

export type ManualWritingHandoffStore = {
  findWork(id: string): Promise<ManualWorkRecord | null>;
  createWork(data: ManualWorkCreateInput): Promise<ManualWorkRecord>;
  linkDocumentIfUnlinked(documentId: string, workId: string): Promise<boolean>;
};

export class ManualWritingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ManualWritingError";
  }
}

/** 条件绑定输掉竞态时抛出，由路由回滚整个创建事务后读取胜者。 */
export class ManualWritingHandoffRaceError extends Error {
  constructor() {
    super("文档已由另一个请求交接");
    this.name = "ManualWritingHandoffRaceError";
  }
}

/** 完成/预览只验证私有写作台自身边界，不限制作者继续写作和导出长文。 */
export function validateManualWritingPreview(document: Pick<ManualWritingDocument, "title" | "content">) {
  const title = document.title.trim();
  if (!title) throw new ManualWritingError("请先填写标题", 400);
  if (title.length > 200) throw new ManualWritingError("标题最多 200 个字符", 400);
  // Whitespace is meaningful author input (especially in Markdown/code). Use a
  // trimmed view only for the empty check; length and handoff keep every byte of
  // the original body intact.
  if (!document.content.trim()) throw new ManualWritingError("请先写下正文", 400);
  if (document.content.length > MAX_WRITING_DOC_CONTENT_LENGTH) {
    throw new ManualWritingError(`私有文档最多保存 ${MAX_WRITING_DOC_CONTENT_LENGTH} 个字符`, 400);
  }
  return { title, content: document.content };
}

/** 手写文档交接给 CreativeWork 前的硬边界，与作品评分/编辑 API 完全一致。 */
export function validateManualWritingDocument(document: Pick<ManualWritingDocument, "title" | "content">) {
  const normalized = validateManualWritingPreview(document);
  if (normalized.content.length > MAX_SCORABLE_WORK_CONTENT_LENGTH) {
    throw new ManualWritingError(
      `社区评分必须覆盖全文，正文最多 ${MAX_SCORABLE_WORK_CONTENT_LENGTH} 个字符。私有原稿仍会完整保留，你可以继续编辑或导出。`,
      409
    );
  }
  return normalized;
}

/** 从手写 Markdown 提取一段不换写作者原文的列表摘要。 */
export function deriveManualSummary(content: string, maxLength = 180) {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function assertManualWork(work: ManualWorkRecord | null) {
  if (!work) throw new ManualWritingError("已绑定的作品不存在，请刷新后重试", 409);
  if (work.mode !== "MANUAL") {
    throw new ManualWritingError("文档绑定的作品类型不正确，无法继续", 409);
  }
  return work;
}

/**
 * 将已完成的 WritingDoc 单向交接给社区发布流程。
 *
 * 重要不变式：
 * - 文档已绑定时只返回原作品，绝不用 WritingDoc 覆盖已编辑/评分/发布的内容；
 * - 首次交接使用条件更新抢占唯一绑定，并发请求的败者抛出竞态错误，
 *   让路由回滚「创建作品 + 绑定文档」的整个事务；
 * - 这个过程不调用 AI，AI 评分仍由用户在下一步显式触发。
 */
export async function handoffManualWritingDocument(input: {
  document: ManualWritingDocument;
  genreId: string;
  depth: ManualWritingDepth;
  clientIp: string | null;
  store: ManualWritingHandoffStore;
}): Promise<{ work: ManualWorkRecord; created: boolean }> {
  const { document, store } = input;
  if (document.publicationBlockedAt) {
    throw new ManualWritingError(
      "这份私有原稿仍可继续编辑和导出，但因对应公开副本被内容治理删除，社区交接已锁定。",
      409
    );
  }
  if (document.creativeWorkId) {
    return { work: assertManualWork(await store.findWork(document.creativeWorkId)), created: false };
  }

  const normalized = validateManualWritingDocument(document);
  const created = await store.createWork({
    ownerId: document.ownerId,
    anonId: document.ownerId ? null : document.anonId,
    clientIp: input.clientIp,
    genreId: input.genreId,
    mode: "MANUAL",
    depth: input.depth,
    status: "DRAFT",
    topic: normalized.title,
    interview: "[]",
    pendingQuestion: null,
    title: normalized.title,
    summary: deriveManualSummary(normalized.content),
    content: normalized.content,
    draftGeneratedAt: null
  });

  if (await store.linkDocumentIfUnlinked(document.id, created.id)) {
    return { work: created, created: true };
  }
  throw new ManualWritingHandoffRaceError();
}
