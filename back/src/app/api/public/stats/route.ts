import { NextResponse } from "next/server";
import { loadStats, type StatsWindow } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const w = url.searchParams.get("window");
  const window: StatsWindow = w === "today" || w === "week" || w === "total" ? w : "week";
  const stats = await loadStats(window);
  return NextResponse.json(stats);
}
