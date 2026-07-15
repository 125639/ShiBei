import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentMember } from "@/lib/member-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

async function commentsEnabled(): Promise<boolean> {
  const settings = await prisma.siteSettings.findUnique({
    where: { id: "site" },
    select: { commentsEnabled: true }
  });
  return Boolean(settings?.commentsEnabled);
}

function authorName(member: { displayName: string | null; username: string | null; email: string | null }) {
  return member.displayName || member.username || (member.email ? member.email.split("@")[0] : "会员");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await commentsEnabled())) {
    return NextResponse.json({ enabled: false, comments: [], member: null });
  }

  const [rows, member] = await Promise.all([
    prisma.comment.findMany({
      where: { postId: id, post: { status: "PUBLISHED", publicationBlockedReason: null } },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { member: { select: { displayName: true, username: true, email: true } } }
    }),
    getCurrentMember()
  ]);

  return NextResponse.json({
    enabled: true,
    member: member ? { id: member.id, name: authorName(member) } : null,
    comments: rows.map((row) => ({
      id: row.id,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      author: authorName(row.member),
      mine: member ? row.memberId === member.id : false
    }))
  });
}

const CreateSchema = z.object({
  content: z.string().trim().min(1, "评论不能为空").max(2000, "评论最多 2000 字")
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await commentsEnabled())) {
    return NextResponse.json({ error: "评论功能未开启" }, { status: 403 });
  }

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "请先登录后再评论" }, { status: 401 });
  }

  const limited = await checkRateLimit({
    namespace: "comment-create",
    request,
    subject: member.id,
    limit: 10,
    windowSec: 5 * 60
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "评论太频繁了，歇一会儿再发" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  const parsed = await parseJsonBody(request, CreateSchema);
  if (!parsed.ok) return parsed.response;

  const post = await prisma.post.findUnique({
    where: { id },
    select: { id: true, status: true, publicationBlockedReason: true }
  });
  if (!post || post.status !== "PUBLISHED" || post.publicationBlockedReason) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  const comment = await prisma.comment.create({
    data: { postId: post.id, memberId: member.id, content: parsed.data.content }
  });

  return NextResponse.json({
    comment: {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      author: authorName(member),
      mine: true
    }
  });
}
