import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  insertVideoShortcode,
  normalizeVideoPlacement,
  removeVideoShortcode,
  type VideoPlacement
} from "@/lib/video-display";

type ReorderItem = {
  id: string;
  sortOrder: number;
  placement?: string;
};

type ReorderBody = {
  postId?: string | null;
  items: ReorderItem[];
};

export async function POST(request: Request) {
  await requireAdmin();
  let body: ReorderBody;
  try {
    body = (await request.json()) as ReorderBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items must be non-empty" }, { status: 400 });
  }

  const items = body.items
    .map((item) => ({
      id: String(item.id || "").trim(),
      sortOrder: Number.isFinite(item.sortOrder) ? Math.floor(item.sortOrder) : 0,
      placement: normalizeVideoPlacement(item.placement)
    }))
    .filter((item) => item.id);

  if (items.length === 0) {
    return NextResponse.json({ error: "no valid items" }, { status: 400 });
  }

  const postId = body.postId ? String(body.postId).trim() : "";

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      await tx.video.update({
        where: { id: item.id },
        data: {
          sortOrder: item.sortOrder,
          lastPlacement: item.placement
        }
      });
    }

    if (postId) {
      const post = await tx.post.findUnique({
        where: { id: postId },
        select: { id: true, content: true, contentEn: true }
      });
      if (post) {
        const reorderedContent = rebuildPostContent(post.content, items);
        const reorderedContentEn = post.contentEn ? rebuildPostContent(post.contentEn, items) : null;
        await tx.post.update({
          where: { id: post.id },
          data: {
            content: reorderedContent,
            ...(reorderedContentEn !== null ? { contentEn: reorderedContentEn } : {})
          }
        });
      }
    }
  });

  revalidatePath("/admin/videos");
  if (postId) revalidatePath(`/admin/posts/${postId}`);

  return NextResponse.json({ ok: true });
}

function rebuildPostContent(content: string, items: Array<{ id: string; placement: VideoPlacement }>) {
  let next = content;
  for (const item of items) {
    next = removeVideoShortcode(next, item.id);
  }
  for (const item of items) {
    next = insertVideoShortcode(next, item.id, item.placement);
  }
  return next;
}
