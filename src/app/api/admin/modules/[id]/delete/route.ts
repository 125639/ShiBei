import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await (prisma as unknown as {
    sourceModule: { delete: (args: unknown) => Promise<unknown> };
  }).sourceModule.delete({ where: { id } }).catch(() => undefined);
  return redirectTo("/admin/modules");
}
