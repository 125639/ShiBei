import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { actorOwnsWork, getCreationActor, serializeWorkForOwner } from "@/lib/creation-server";

export const dynamic = "force-dynamic";

async function loadOwnedWork(id: string) {
  const work = await prisma.creativeWork.findUnique({ where: { id }, include: { genre: true } });
  if (!work) return { error: NextResponse.json({ error: "作品不存在" }, { status: 404 }) };
  const actor = await getCreationActor();
  if (!actorOwnsWork(work, actor)) {
    // 对非所有者一律 404，不泄露私有作品的存在。
    return { error: NextResponse.json({ error: "作品不存在" }, { status: 404 }) };
  }
  return { work, actor };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadOwnedWork(id);
  if ("error" in loaded) return loaded.error;
  return NextResponse.json({ work: serializeWorkForOwner(loaded.work) });
}

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(1000).optional(),
  content: z.string().max(100000).optional()
});

// 编辑草稿。内容改动后原评分自动失效（发布校验内容指纹），需重新评分。
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadOwnedWork(id);
  if ("error" in loaded) return loaded.error;
  const { work } = loaded;

  if (work.status !== "DRAFT") {
    return NextResponse.json(
      { error: work.status === "SHARED" ? "已公开的作品不可编辑" : "请先完成访谈并生成草稿" },
      { status: 409 }
    );
  }

  const parsed = await parseJsonBody(request, PatchSchema);
  if (!parsed.ok) return parsed.response;

  const updated = await prisma.creativeWork.update({
    where: { id: work.id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.summary !== undefined ? { summary: parsed.data.summary } : {}),
      ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {})
    },
    include: { genre: true }
  });
  return NextResponse.json({ work: serializeWorkForOwner(updated) });
}

// 删除权：登录创作者可随时删除（包括已公开的）；
// 匿名作品一旦公开即不可删除——这是未登录发布前明确确认过的条款。
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadOwnedWork(id);
  if ("error" in loaded) return loaded.error;
  const { work } = loaded;

  if (!work.ownerId && work.status === "SHARED") {
    return NextResponse.json(
      { error: "匿名发布的作品不可删除。注册账号后发布的作品可随时删除。" },
      { status: 403 }
    );
  }

  const wasShared = work.status === "SHARED";
  await prisma.creativeWork.delete({ where: { id: work.id } });
  if (wasShared) {
    // 删除已公开作品必须立即从 /community/[slug] 缓存消失，不等兜底刷新。
    revalidateTag("community-content");
  }
  return NextResponse.json({ ok: true });
}
