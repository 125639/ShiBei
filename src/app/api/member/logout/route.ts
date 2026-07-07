import { NextResponse } from "next/server";
import { clearMemberSessionCookie } from "@/lib/member-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearMemberSessionCookie();
  return NextResponse.json({ ok: true });
}
