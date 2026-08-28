import { getAnonId, getMemberSession } from "./member-auth";
import { prisma } from "./prisma";

// 写作台文档所有权：登录会员只按 ownerId，未登录时才按 anonId cookie。
// 两种身份严格互斥，防止登录用户借同一浏览器残留的匿名 cookie 越权。

export type WritingDocIdentity = { memberId: string | null; anonId: string | null };

export async function getWritingIdentity(): Promise<WritingDocIdentity> {
  const session = await getMemberSession();
  if (session) return { memberId: session.memberId, anonId: null };
  return { memberId: null, anonId: (await getAnonId()) || null };
}

export function docOwnershipWhere(identity: WritingDocIdentity) {
  if (identity.memberId) return { ownerId: identity.memberId };
  if (identity.anonId) return { anonId: identity.anonId, ownerId: null };
  return { id: "__never__" };
}

export type WritingDocRevision = {
  id: string;
  ownerId: string | null;
  anonId: string | null;
  creativeWorkId: string | null;
  updatedAt: Date;
};

/**
 * Editing is a one-revision claim: a handoff changes creativeWorkId and a
 * concurrent edit changes updatedAt, so either event makes a stale PATCH lose
 * instead of writing through the immutable source snapshot.
 */
export function editableWritingDocRevisionWhere(
  doc: WritingDocRevision,
  identity: WritingDocIdentity,
  expectedUpdatedAt: Date
) {
  return {
    id: doc.id,
    ...docOwnershipWhere(identity),
    creativeWorkId: null,
    updatedAt: expectedUpdatedAt
  };
}

/** Delete the exact owned revision that was authorized, including its binding. */
export function deletableWritingDocRevisionWhere(
  doc: WritingDocRevision,
  identity: WritingDocIdentity,
  expectedUpdatedAt: Date
) {
  return {
    id: doc.id,
    ...docOwnershipWhere(identity),
    creativeWorkId: doc.creativeWorkId,
    updatedAt: expectedUpdatedAt
  };
}

export async function findOwnedDoc(id: string, identity: WritingDocIdentity) {
  if (!identity.memberId && !identity.anonId) return null;
  return prisma.writingDoc.findFirst({ where: { id, ...docOwnershipWhere(identity) } });
}

/**
 * 完成/交接是比普通查看更强的动作：登录会话只能处理已归属该会员的文档，
 * 不能借浏览器残留的匿名 cookie 将匿名文档转成会员作品。
 */
export function identityStrictlyOwnsWritingDoc(
  doc: { ownerId: string | null; anonId: string | null },
  identity: WritingDocIdentity
) {
  if (identity.memberId) return doc.ownerId === identity.memberId;
  return Boolean(!doc.ownerId && identity.anonId && doc.anonId === identity.anonId);
}

export function serializeWritingDoc(doc: {
  id: string;
  title: string;
  content?: string;
  completedAt: Date | null;
  creativeWorkId: string | null;
  publicationBlockedAt: Date | null;
  updatedAt: Date;
}) {
  return {
    id: doc.id,
    title: doc.title,
    ...(doc.content !== undefined ? { content: doc.content } : {}),
    completedAt: doc.completedAt?.toISOString() ?? null,
    creativeWorkId: doc.creativeWorkId,
    publicationBlockedAt: doc.publicationBlockedAt?.toISOString() ?? null,
    updatedAt: doc.updatedAt.toISOString()
  };
}
