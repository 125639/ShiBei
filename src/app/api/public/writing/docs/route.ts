import { NextResponse } from "next/server";
import {
  AnonymousBootstrapRequiredError,
  ensureAnonIdForCreationRequest,
  getMemberSession
} from "@/lib/member-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  ListPaginationError,
  descendingUpdatedAtCursorWhere,
  finishDescendingUpdatedAtPage,
  identityBoundListScope,
  parseListPageRequest
} from "@/lib/list-pagination";
import { docOwnershipWhere, getWritingIdentity, serializeWritingDoc } from "@/lib/writing-docs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await getWritingIdentity();
  const cursorScope = identityBoundListScope("writing-docs", identity);
  let pagination;
  try {
    pagination = parseListPageRequest(request.url, {
      scope: cursorScope,
      defaultPageSize: 100,
      maxPageSize: 100
    });
  } catch (error) {
    if (error instanceof ListPaginationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  if (!identity.memberId && !identity.anonId) {
    return NextResponse.json({ docs: [], nextCursor: null, hasMore: false });
  }
  const docRows = await prisma.writingDoc.findMany({
    where: {
      ...docOwnershipWhere(identity),
      ...descendingUpdatedAtCursorWhere(pagination.cursor)
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: pagination.pageSize + 1,
    select: {
      id: true,
      title: true,
      completedAt: true,
      creativeWorkId: true,
      publicationBlockedAt: true,
      updatedAt: true
    }
  });
  const page = finishDescendingUpdatedAtPage(cursorScope, docRows, pagination.pageSize);
  return NextResponse.json({
    docs: page.items.map(serializeWritingDoc),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore
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
  let anonId: string | null = null;
  try {
    anonId = session ? null : await ensureAnonIdForCreationRequest(request);
  } catch (error) {
    if (error instanceof AnonymousBootstrapRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const doc = await prisma.writingDoc.create({
    data: { ownerId: session?.memberId || null, anonId }
  });
  return NextResponse.json({
    doc: serializeWritingDoc(doc)
  });
}
