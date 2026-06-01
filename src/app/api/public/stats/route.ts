import { NextResponse } from "next/server";
import { loadCachedStats, type StatsWindow } from "@/lib/stats";

export const revalidate = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const w = url.searchParams.get("window");
  const window: StatsWindow = w === "today" || w === "week" || w === "total" ? w : "week";
  const stats = await loadCachedStats(window);
  return NextResponse.json(stats, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120"
    }
  });
}
