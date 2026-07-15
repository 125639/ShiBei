import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { isManualStorageCleanupConfirmed } from "@/lib/storage-cleanup-policy";
import { runStorageCleanup } from "@/lib/storage";
import { redirectTo } from "@/lib/redirect";

export async function POST(request: Request) {
  await requireAdmin();
  const originDenied = rejectCrossOriginMutation(request);
  if (originDenied) return originDenied;

  const form = await request.formData().catch(() => null);
  if (!form || !isManualStorageCleanupConfirmed(form.get("confirmation"))) {
    return NextResponse.json(
      { error: "手动清理未经过明确确认，未执行任何清理操作。" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const result = await runStorageCleanup({ trigger: "manual" });
    console.log("[storage] manual cleanup:", result);
    const params = new URLSearchParams({
      tab: "storage",
      cleanup: "success",
      jobs: String(result.fetchJobsDeleted),
      raw: String(result.rawItemsDeleted),
      posts: String(result.archivedPosts),
      videos: String(result.videoFilesDeleted),
      bytes: String(result.bytesFreed)
    });
    return redirectTo(`/admin/settings?${params.toString()}`, request);
  } catch (error) {
    console.error("[storage] manual cleanup failed:", error);
    return redirectTo("/admin/settings?tab=storage&cleanup=error", request);
  }
}
