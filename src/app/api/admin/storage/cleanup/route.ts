import { requireAdmin } from "@/lib/auth";
import { runStorageCleanup } from "@/lib/storage";
import { redirectTo } from "@/lib/redirect";

export async function POST() {
  await requireAdmin();
  const result = await runStorageCleanup({ force: true });
  console.log("[storage] manual cleanup:", result);
  return redirectTo("/admin/settings");
}
