import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createInviteCodes, inviteCodeForAdmin } from "@/lib/invite-codes";
import { prisma } from "@/lib/prisma";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  count: z.coerce.number().int().min(1).max(100),
  note: z.string().trim().max(120).optional().default("")
});

export async function GET(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const rawPage = Number(url.searchParams.get("page") || 1);
  const requestedPage = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = 100;
  const total = await prisma.inviteCode.count();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const codes = await prisma.inviteCode.findMany({
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { member: { select: { username: true, displayName: true } } }
  });
  return NextResponse.json({
    page,
    total,
    totalPages,
    codes: codes.map((row) => ({
      id: row.id,
      code: inviteCodeForAdmin(row.status, row.code),
      status: row.status,
      note: row.note,
      usedBy: row.member ? row.member.displayName || row.member.username : null,
      usedAt: row.usedAt ? row.usedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString()
    }))
  });
}

export async function POST(request: Request) {
  await requireAdmin();
  const parsed = await parseJsonBody(request, CreateSchema);
  if (!parsed.ok) return parsed.response;

  const codes = await createInviteCodes(parsed.data.count, parsed.data.note);
  return NextResponse.json({ codes });
}
