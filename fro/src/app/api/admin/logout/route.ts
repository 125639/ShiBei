import { clearSessionCookie } from "@/lib/auth";
import { redirectTo } from "@/lib/redirect";

export async function POST() {
  await clearSessionCookie();
  return redirectTo("/admin/login");
}
