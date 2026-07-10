import { NextResponse } from "next/server";
import { ensureAnonId, getMemberSession } from "@/lib/member-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { docOwnershipWhere, getWritingIdentity } from "@/lib/writing-docs";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await getWritingIdentity();
  if (!identity.memberId && !identity.anonId) {
    return NextResponse.json({ docs: [] });
  }
  const docs = await prisma.writingDoc.findMany({
    where: docOwnershipWhere(identity),
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, updatedAt: true }
  });
  return NextResponse.json({
    docs: docs.map((doc) => ({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt.toISOString() }))
  });
}

export async function POST(request: Request) {
  const limited = await checkRateLimit({
    namespace: "writing-doc-create",
    request,
    limit: 30,
    windowSec: 60 * 60
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "创建太频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  const session = await getMemberSession();
  // 匿名写作跟随浏览器 cookie(与共创工作室同一套身份)
  const anonId = session ? null : await ensureAnonId();

  const doc = await prisma.writingDoc.create({
    data: { ownerId: session?.memberId || null, anonId }
  });
  return NextResponse.json({
    doc: { id: doc.id, title: doc.title, content: doc.content, updatedAt: doc.updatedAt.toISOString() }
  });
}
