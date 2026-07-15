import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  adminPasswordProblem,
  adminUsernameProblem,
  normalizeAdminUsername
} from "../src/lib/admin-credentials";
import {
  appModeSupports,
  isPathAvailableInAppMode,
  requiresLocalWorker
} from "../src/lib/app-mode";

test("frontend mode consistently rejects local-worker pages and mutation APIs", () => {
  assert.equal(appModeSupports("frontend", "local-worker"), false);
  assert.equal(appModeSupports("backend", "local-worker"), true);
  assert.equal(appModeSupports("full", "local-worker"), true);

  for (const path of [
    "/admin/ai",
    "/admin/jobs/abc",
    "/admin/sources",
    "/api/admin/ai-admin/retry",
    "/api/admin/posts/assist",
    "/api/admin/posts/bulk-repair"
  ]) {
    assert.equal(requiresLocalWorker(path), true, path);
    assert.equal(isPathAvailableInAppMode(path, "frontend"), false, path);
    assert.equal(isPathAvailableInAppMode(path, "full"), true, path);
  }
  assert.equal(isPathAvailableInAppMode("/admin/posts", "frontend"), true);
  assert.equal(isPathAvailableInAppMode("/api/admin/posts/bulk", "frontend"), true);
});

test("administrator credentials use the same strong-password policy as members", () => {
  assert.equal(normalizeAdminUsername("  owner  "), "owner");
  assert.match(adminUsernameProblem("x") || "", /3/);
  assert.match(adminUsernameProblem("bad\nname") || "", /控制字符/);
  assert.equal(adminUsernameProblem("site-owner"), null);
  assert.match(adminPasswordProblem("short", "site-owner") || "", /12/);
  assert.match(adminPasswordProblem("Site-owner-Aa1!", "site-owner") || "", /账号名/);
  assert.equal(adminPasswordProblem("Different-Aa1!234", "site-owner"), null);
});

test("account update is bound to the authenticated administrator and revokes password sessions", () => {
  const source = readFileSync(
    new URL("../src/app/api/admin/settings/admin/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /const session = await requireAdmin\(\)/);
  assert.match(source, /where: \{ id: session\.userId \}/);
  assert.doesNotMatch(source, /adminUser\.findFirst/);
  assert.match(source, /tokenVersion: \{ increment: 1 \}/);
  assert.match(source, /await clearSessionCookie\(\)/);
});

test("irreversible admin actions and live-write scripts require explicit confirmation", () => {
  const invite = readFileSync(new URL("../src/components/AdminInviteManager.tsx", import.meta.url), "utf8");
  const comment = readFileSync(new URL("../src/components/AdminCommentManager.tsx", import.meta.url), "utf8");
  assert.match(invite, /window\.confirm\(/);
  assert.match(comment, /window\.confirm\(/);

  for (const relative of [
    "../scripts/e2e/run-ai-research-live.mjs",
    "../scripts/e2e/run-post-repair-live.mjs"
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /ALLOW_LIVE_WRITE/);
    assert.match(source, /!== "1"/);
  }
});
