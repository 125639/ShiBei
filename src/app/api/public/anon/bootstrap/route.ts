import { NextResponse } from "next/server";
import { z } from "zod";
import {
  anonBootstrapRequestRejection,
  deriveAnonIdFromBootstrapSeed
} from "@/lib/anon-bootstrap";
import { getAnonId, setAnonIdCookieIfMissing } from "@/lib/member-auth";
import { parseJsonBody } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ seed: z.string().uuid() }).strict();

export async function POST(request: Request) {
  const rejected = anonBootstrapRequestRejection(request);
  if (rejected) {
    return NextResponse.json(
      { error: rejected.error },
      { status: rejected.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return parsed.response;

  // 最重要的不变量：已有 HttpOnly 身份绝不由客户端 seed 覆盖。
  if (await getAnonId()) {
    return NextResponse.json(
      { ok: true, created: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const anonId = deriveAnonIdFromBootstrapSeed(parsed.data.seed);
  await setAnonIdCookieIfMissing(anonId);
  return NextResponse.json(
    { ok: true, created: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}
