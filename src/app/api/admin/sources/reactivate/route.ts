import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

// 恢复被自动暂停（连续失败达阈值）的来源：状态设回 ACTIVE 并清零 failStreak，
// 让它重新进入自动抓取。否则一次瞬时故障触发阈值后来源会被永久排除。
export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();
  const sourceId = String(form.get("sourceId") || "");

  if (sourceId) {
    await prisma.source.update({
      where: { id: sourceId },
      data: { status: "ACTIVE", failStreak: 0 }
    });
  }

  return redirectTo("/admin/sources");
}
