import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import {
  adminPasswordProblem,
  adminUsernameProblem,
  normalizeAdminUsername
} from "@/lib/admin-credentials";
import { clearSessionCookie, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { rejectCrossOriginMutation } from "@/lib/request-origin";

export async function POST(request: Request) {
  const session = await requireAdmin();
  const originDenied = rejectCrossOriginMutation(request);
  if (originDenied) return originDenied;

  const form = await request.formData();
  const username = normalizeAdminUsername(String(form.get("username") || ""));
  const password = String(form.get("password") || "");
  if (adminUsernameProblem(username)) {
    return redirectTo("/admin/settings?tab=account&accountError=invalid_username", request);
  }
  if (password && adminPasswordProblem(password, username)) {
    return redirectTo("/admin/settings?tab=account&accountError=weak_password", request);
  }

  const admin = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: { id: true, passwordHash: true, tokenVersion: true }
  });
  if (!admin) {
    await clearSessionCookie();
    return redirectTo("/admin/login?error=1", request);
  }
  if (password && await bcrypt.compare(password, admin.passwordHash)) {
    return redirectTo("/admin/settings?tab=account&accountError=same_password", request);
  }

  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  try {
    const updated = await prisma.adminUser.updateMany({
      where: { id: admin.id, tokenVersion: admin.tokenVersion },
      data: {
        username,
        ...(passwordHash
          ? { passwordHash, tokenVersion: { increment: 1 } }
          : {})
      }
    });
    if (updated.count !== 1) {
      return redirectTo("/admin/settings?tab=account&accountError=session_changed", request);
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return redirectTo("/admin/settings?tab=account&accountError=username_taken", request);
    }
    throw error;
  }

  if (passwordHash) {
    // The token-version CAS above revokes every previously issued token. Remove
    // the current cookie as well so the browser does not keep presenting a
    // known-invalid credential on the next request.
    await clearSessionCookie();
    return redirectTo("/admin/login?accountChanged=1", request);
  }

  return redirectTo("/admin/settings?tab=account&saved=1", request);
}
