import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/auth";

/** Persistent workspace: navigation and background checks survive page changes.
 * Pages retain their own authorization guard because a reused layout is not an
 * authorization boundary for subsequent RSC requests or mutations.
 */
export default async function AdminWorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <AdminShell>{children}</AdminShell>;
}
