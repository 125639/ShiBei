import { z } from "zod";
import { workScoreFingerprint } from "./creation";

export const CommunityModerationRequestSchema = z.object({
  action: z.enum(["UNPUBLISH", "DELETE"]),
  reason: z.string().trim().min(3, "请填写至少 3 个字符的治理原因").max(1000, "治理原因最多 1000 个字符")
});

export type CommunityModerationAction = z.infer<typeof CommunityModerationRequestSchema>["action"];

/** 管理后台作品读取边界：任何治理列表和目标查询都只能从公开态开始。 */
export const SHARED_COMMUNITY_WORK_WHERE = { status: "SHARED" as const };

export type SharedCommunityWorkSnapshot = {
  id: string;
  status: "SHARED";
  title: string;
  summary: string;
  content: string;
  slug: string | null;
  ownerId: string | null;
};

export type CommunityModerationAuditInput = {
  adminId: string;
  action: CommunityModerationAction;
  reason: string;
  targetWorkId: string;
  titleSnapshot: string;
  summarySnapshot: string;
  slugSnapshot: string | null;
  wasAnonymous: boolean;
};

export type CommunityModerationStore = {
  findSharedWork(id: string): Promise<SharedCommunityWorkSnapshot | null>;
  unpublishSharedWork(id: string, surface: {
    algorithm: "TITLE_SUMMARY_CONTENT_V2";
    surfaceHash: string;
    reason: string;
  }): Promise<boolean>;
  deleteSharedWork(id: string): Promise<boolean>;
  createAudit(data: CommunityModerationAuditInput): Promise<void>;
};

export class CommunityModerationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CommunityModerationError";
  }
}

/**
 * 管理员会话与会员会话使用不同 cookie/JWT 字段；这里只接受 auth.getSession
 * 返回的 userId，memberId 或空身份都必须失败。
 */
export function requireCommunityModerator(session: unknown): string {
  if (typeof session !== "object" || session === null) {
    throw new CommunityModerationError("需要管理员登录", 401);
  }
  const userId = (session as { userId?: unknown }).userId;
  if (typeof userId !== "string" || !userId) {
    throw new CommunityModerationError("需要管理员登录", 401);
  }
  return userId;
}

/**
 * 仅治理当前仍为 SHARED 的作品。调用方必须把这个服务放在数据库事务中，保证
 * 状态变化与审计日志同成同败；store 的两个写操作还需用 status=SHARED 条件更新。
 */
export async function moderateSharedCommunityWork(input: {
  adminId: string;
  workId: string;
  action: CommunityModerationAction;
  reason: string;
  store: CommunityModerationStore;
}) {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 1000) {
    throw new CommunityModerationError("治理原因应为 3-1000 个字符", 400);
  }

  const work = await input.store.findSharedWork(input.workId);
  if (!work || work.status !== "SHARED") {
    // 不区分不存在与私有草稿，避免治理接口被误用来探测私有作品。
    throw new CommunityModerationError("公开作品不存在或已被治理", 404);
  }

  const changed = input.action === "UNPUBLISH"
    ? await input.store.unpublishSharedWork(work.id, {
        algorithm: "TITLE_SUMMARY_CONTENT_V2",
        surfaceHash: workScoreFingerprint(work),
        reason
      })
    : await input.store.deleteSharedWork(work.id);
  if (!changed) {
    throw new CommunityModerationError("作品状态刚刚发生变化，请刷新后重试", 409);
  }

  const audit: CommunityModerationAuditInput = {
    adminId: input.adminId,
    action: input.action,
    reason,
    targetWorkId: work.id,
    titleSnapshot: work.title,
    summarySnapshot: work.summary,
    slugSnapshot: work.slug,
    wasAnonymous: work.ownerId === null
  };
  await input.store.createAudit(audit);
  return { work, audit };
}
