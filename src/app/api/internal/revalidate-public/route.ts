import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getInternalRevalidationSecret,
  INTERNAL_REVALIDATION_MAX_BODY_BYTES,
  INTERNAL_REVALIDATION_MAX_PATHS,
  INTERNAL_REVALIDATION_SIGNATURE_HEADER,
  INTERNAL_REVALIDATION_TIMESTAMP_HEADER,
  normalizePublicRevalidationPaths,
  verifyInternalRevalidationRequest
} from "@/lib/internal-revalidation";
import { revalidatePublicContent } from "@/lib/revalidate-public";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  paths: z.array(z.string().min(1).max(500)).max(INTERNAL_REVALIDATION_MAX_PATHS)
}).strict();

export async function POST(request: Request) {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return jsonError("请求格式不受支持", 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > INTERNAL_REVALIDATION_MAX_BODY_BYTES) {
    return jsonError("请求体过大", 413);
  }

  const raw = await readBoundedText(request, INTERNAL_REVALIDATION_MAX_BODY_BYTES);
  if (raw === null) return jsonError("请求体过大", 413);

  let secret: string;
  try {
    secret = getInternalRevalidationSecret();
  } catch (error) {
    console.error("[internal-revalidation] AUTH_SECRET unavailable", error);
    return jsonError("服务暂时不可用", 503);
  }
  const verified = verifyInternalRevalidationRequest({
    body: raw,
    timestamp: request.headers.get(INTERNAL_REVALIDATION_TIMESTAMP_HEADER),
    signature: request.headers.get(INTERNAL_REVALIDATION_SIGNATURE_HEADER),
    secret
  });
  if (!verified.ok) return jsonError("未授权", 401);

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return jsonError("请求体不是有效的 JSON", 400);
  }
  const parsed = BodySchema.safeParse(input);
  if (!parsed.success) return jsonError("请求参数有误", 400);

  const paths = normalizePublicRevalidationPaths(parsed.data.paths);
  if (paths.length !== new Set(parsed.data.paths.map((path) => path.trim())).size) {
    return jsonError("请求包含无效的刷新路径", 400);
  }

  revalidatePublicContent(paths);
  return NextResponse.json(
    { ok: true, revalidated: paths.length },
    { headers: { "cache-control": "no-store" } }
  );
}

async function readBoundedText(request: Request, maxBytes: number) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { "cache-control": "no-store" } }
  );
}
