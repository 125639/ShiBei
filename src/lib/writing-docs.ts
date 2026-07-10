import { getAnonId, getMemberSession } from "./member-auth";
import { prisma } from "./prisma";

// 写作台文档所有权:登录会员按 ownerId,匿名按 anonId cookie。
// 会员登录后也能看到本浏览器尚未认领的匿名文档(登录动作本身会认领)。

export type WritingDocIdentity = { memberId: string | null; anonId: string | null };

export async function getWritingIdentity(): Promise<WritingDocIdentity> {
  const [session, anonId] = await Promise.all([getMemberSession(), getAnonId()]);
  return { memberId: session?.memberId || null, anonId: anonId || null };
}

export function docOwnershipWhere(identity: WritingDocIdentity) {
  const clauses = [];
  if (identity.memberId) clauses.push({ ownerId: identity.memberId });
  if (identity.anonId) clauses.push({ anonId: identity.anonId, ownerId: null });
  return clauses.length ? { OR: clauses } : { id: "__never__" };
}

export async function findOwnedDoc(id: string, identity: WritingDocIdentity) {
  if (!identity.memberId && !identity.anonId) return null;
  return prisma.writingDoc.findFirst({ where: { id, ...docOwnershipWhere(identity) } });
}
