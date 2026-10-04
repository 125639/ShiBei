import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { formatBytes, reportStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Directory scanning belongs to the storage tab, never the settings critical path. */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const report = await reportStorage();
    return NextResponse.json(
      {
        ...report,
        uploadsBytes: formatBytes(report.uploadsBytes),
        imageBytes: formatBytes(report.imageBytes),
        musicBytes: formatBytes(report.musicBytes),
        videoBytes: formatBytes(report.videoBytes),
        approxDbBytesEstimate: formatBytes(report.approxDbBytesEstimate)
      },
      { headers }
    );
  } catch (error) {
    console.error("[admin-storage] usage scan failed", error);
    return NextResponse.json({ error: "Storage report unavailable" }, { status: 503, headers });
  }
}
