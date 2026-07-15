import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";
import { actorOwnsWork, getCreationActor, serializeWorkForOwner } from "@/lib/creation-server";
import {
  anonymousWorkWasPublished,
  scoreInvalidationData,
  scoreSurfaceChanged,
  workDeletionWhere,
  workRevisionWhere
} from "@/lib/creation";
import { MAX_SCORABLE_WORK_CONTENT_LENGTH } from "@/lib/creation-limits";

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
  return NextResponse.json({ work: await serializeWorkForOwner(loaded.work) });
}

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(1000).optional(),
  content: z.string().max(
    MAX_SCORABLE_WORK_CONTENT_LENGTH,
    `社区评分作品正文最多 ${MAX_SCORABLE_WORK_CONTENT_LENGTH} 个字符`
  ).optional(),
  // 来自客户端实际打开/上次保存成功的版本。只用路由内刚查到的 updatedAt
  // 只能挡住同时重叠的请求，挡不住旧标签页稍后覆盖一个已经更新的新版本。
  expectedUpdatedAt: z.string().datetime()
});

// 编辑草稿。评分模型读取过的标题、公开摘要或正文一旦改变，服务端立即清空整份评分，
// 不能只依赖发布时才发现哈希不一致。
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
  if (
    parsed.data.title === undefined &&
    parsed.data.summary === undefined &&
    parsed.data.content === undefined
  ) {
    return NextResponse.json({ work: await serializeWorkForOwner(work) });
  }

  const scoreChanged = scoreSurfaceChanged(work, parsed.data);
  const claimed = await prisma.creativeWork.updateMany({
    // 乐观锁同时挡住已开始但晚于发布落库的 PATCH：发布把 status/updatedAt
    // 改掉后，这个旧编辑请求只能得到 409，绝不能改写已公开快照。
    where: {
      ...workRevisionWhere(work),
      updatedAt: new Date(parsed.data.expectedUpdatedAt)
    },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.summary !== undefined ? { summary: parsed.data.summary } : {}),
      ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {}),
      ...(scoreChanged ? scoreInvalidationData() : {})
    }
  });
  if (claimed.count === 0) {
    return NextResponse.json(
      { error: "草稿已在其他页面更新或发布，请刷新后重试" },
      { status: 409 }
    );
  }

  const updated = await prisma.creativeWork.findUnique({ where: { id: work.id }, include: { genre: true } });
  if (!updated) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  return NextResponse.json({ work: await serializeWorkForOwner(updated) });
}

// 删除权：登录创作者可随时删除（包括已公开的）；
// 匿名作品一旦曾经公开即不可删除——管理员下架不会恢复删除权，这是未登录
// 发布前明确确认过的条款。
const DeleteSchema = z.object({ expectedUpdatedAt: z.string().datetime() });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadOwnedWork(id);
  if ("error" in loaded) return loaded.error;
  const { work } = loaded;

  const parsed = await parseJsonBody(request, DeleteSchema);
  if (!parsed.ok) return parsed.response;

  if (anonymousWorkWasPublished(work) || (!work.ownerId && work.status === "SHARED")) {
    return NextResponse.json(
      { error: "匿名作品一旦曾公开发布即不可删除，管理员下架不会恢复删除权。" },
      { status: 403 }
    );
  }

  const wasShared = work.status === "SHARED";
  const deleted = await prisma.creativeWork.deleteMany({
    // 删除也必须锁定检查过的版本。否则匿名草稿可在另一个标签页先通过发布
    // CAS 变成 SHARED，再被这里早先通过权限检查的旧 DELETE 删除，绕过
    // “匿名公开后不可删除”的明确承诺。
    where: {
      ...workDeletionWhere(work),
      updatedAt: new Date(parsed.data.expectedUpdatedAt)
    }
  });
  if (deleted.count !== 1) {
    return NextResponse.json(
      { error: "作品刚刚发生变化或已被删除，请刷新后重试" },
      { status: 409 }
    );
  }
  if (wasShared) {
    // 删除已公开作品必须立即从 /community/[slug] 缓存消失，不等兜底刷新。
    revalidateTag("community-content", { expire: 0 });
  }
  return NextResponse.json({ ok: true });
}
