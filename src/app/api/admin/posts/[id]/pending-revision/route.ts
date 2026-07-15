import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const form = await request.formData();
  const expectedUpdatedAt = new Date(String(form.get("expectedUpdatedAt") || ""));
  if (!Number.isFinite(expectedUpdatedAt.getTime())) {
    return redirectTo(`/admin/posts/${id}?editConflict=1`, request);
  }
  const updated = await prisma.post.updateMany({
    where: { id, updatedAt: expectedUpdatedAt },
    data: { pendingRevision: Prisma.DbNull }
  });
  if (updated.count !== 1) return redirectTo(`/admin/posts/${id}?editConflict=1`, request);
  return redirectTo(`/admin/posts/${id}`, request);
}
