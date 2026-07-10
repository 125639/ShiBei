import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request-validation";
import { normalizeVisitPath, recordVisit } from "@/lib/visits";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  path: z.string().max(300),
  unique: z.boolean().optional().default(false)
});

// 页面浏览埋点(sendBeacon/fetch)。失败对访客无感,一律 204,
// 只在限流时给 429 让客户端别再发。
export async function POST(request: Request) {
  const limited = await checkRateLimit({
    namespace: "visit-beacon",
    request,
    limit: 120,
    windowSec: 5 * 60
  });
  if (!limited.ok) {
    return new NextResponse(null, { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } });
  }

  const parsed = await parseJsonBody(request, BodySchema);
  if (!parsed.ok) return new NextResponse(null, { status: 204 });

  const path = normalizeVisitPath(parsed.data.path);
  if (!path) return new NextResponse(null, { status: 204 });

  try {
    await recordVisit({ path, unique: parsed.data.unique });
  } catch (error) {
    console.error("[visit] record failed:", error);
  }
  return new NextResponse(null, { status: 204 });
}
