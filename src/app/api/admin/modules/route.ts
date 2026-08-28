import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin();
  const modules = await (prisma as unknown as {
    sourceModule: {
      findMany: (args: unknown) => Promise<Array<{
        id: string;
        name: string;
        slug: string;
        description: string | null;
        color: string;
        sortOrder: number;
      }>>;
    };
  }).sourceModule.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }).catch(() => []);
  return NextResponse.json({ modules });
}

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const description = String(form.get("description") || "").trim() || null;
  const color = String(form.get("color") || "#9f4f2f");
  const sortOrder = Number(form.get("sortOrder") || 0);
  let slug = slugify(name);
  if (!slug) slug = `mod-${Date.now().toString(36)}`;

  await (prisma as unknown as {
    sourceModule: { create: (args: unknown) => Promise<unknown> };
  }).sourceModule.create({
    data: {
      name,
      slug,
      description,
      color,
      sortOrder: Number.isFinite(sortOrder) ? Math.floor(sortOrder) : 0
    }
  });

  return redirectTo("/admin/modules");
}
