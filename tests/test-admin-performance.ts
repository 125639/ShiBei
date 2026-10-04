import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ADMIN_JOB_LIST_SELECT, summarizeAdminJobs } from "../src/lib/admin-job-data";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("the admin shell is a single protected layout; no parent template remounts it", () => {
  const layout = read("src/app/(console)/admin/(workspace)/layout.tsx");
  assert.match(layout, /await requireAdmin\(\)/);
  assert.match(layout, /<AdminShell>/);
  assert.equal(existsSync(path.join(root, "src/app/(console)/admin/template.tsx")), false);
  assert.ok(existsSync(path.join(root, "src/app/(console)/admin/login/page.tsx")));
  function pages(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? pages(path.join(dir, entry.name))
        : entry.name === "page.tsx"
          ? [path.join(dir, entry.name)]
          : []
    );
  }
  const files = pages(path.join(root, "src/app/(console)/admin/(workspace)"));
  assert.ok(files.length >= 18);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<AdminShell>/, file);
    assert.match(source, /await requireAdmin\(\)/, `${file} must still authorize page RSC requests`);
  }
});

test("request-scoped auth deduplication retains database revocation and fail-closed checks", () => {
  const source = read("src/lib/auth.ts");
  assert.match(source, /import \{ cache \} from "react"/);
  assert.match(source, /getSession = cache\(async function/);
  assert.match(source, /tokenVer !== user.tokenVersion/);
  assert.doesNotMatch(source, /unstable_cache|revalidate|new Map/);
});

test("job counters derive all metric states from one grouped scan", () => {
  assert.deepEqual(summarizeAdminJobs([]), { total: 0, running: 0, queued: 0, failed7d: 0 });
  assert.deepEqual(
    summarizeAdminJobs([
      { status: "COMPLETED", count: 400, failed7d: 0 },
      { status: "FAILED", count: 21, failed7d: 8 },
      { status: "RUNNING", count: 3, failed7d: 0 },
      { status: "QUEUED", count: 5, failed7d: 0 }
    ]),
    { total: 429, running: 3, queued: 5, failed7d: 8 }
  );
});

test("job lists select only display fields and no body/research payload", () => {
  assert.equal(ADMIN_JOB_LIST_SELECT.id, true);
  assert.equal(ADMIN_JOB_LIST_SELECT.error, true);
  assert.equal(ADMIN_JOB_LIST_SELECT._count.select.rawItems, true);
  for (const field of ["rawItems", "modelConfigId", "adminAiBatch", "content", "research", "prompt"]) {
    assert.ok(!(field in ADMIN_JOB_LIST_SELECT), field);
  }
  const detail = read("src/app/(console)/admin/(workspace)/jobs/[id]/page.tsx");
  assert.doesNotMatch(detail, /include:|content: true|markdown: true|contentEn: true/);
});

test("storage scans are authenticated, no-store and absent from settings render", () => {
  const page = read("src/app/(console)/admin/(workspace)/settings/page.tsx");
  assert.doesNotMatch(page, /reportStorage\(/);
  const api = read("src/app/api/admin/storage/usage/route.ts");
  assert.ok(api.indexOf("await getSession()") < api.indexOf("await reportStorage()"));
  assert.match(api, /private, no-store/);
  assert.match(api, /status: 401/);
  const settings = read("src/app/(console)/admin/(workspace)/settings/SettingsClient.tsx");
  assert.match(settings, /activeTab === "storage"/);
  assert.match(settings, /<StorageUsage/);
});

test("sidebar and admin row links disable viewport-wide prefetch", () => {
  assert.match(read("src/components/admin/AdminNavLink.tsx"), /prefetch=\{false\}/);
  assert.match(read("src/components/admin/AdminLink.tsx"), /prefetch=\{false\}/);
  assert.match(read("src/components/admin/AdminNavLink.tsx"), /onPointerLeave=\{cancel\}/);
});

test("polling is transition-aware and hidden editors do not synchronously parse Markdown", () => {
  const polling = read("src/components/AutoRefresh.tsx");
  assert.doesNotMatch(polling, /setInterval/);
  assert.match(polling, /!active \|\| pending/);
  assert.match(polling, /document.visibilityState !== "visible"/);
  const editor = read("src/components/AdminMarkdownWorkspace.tsx");
  assert.match(editor, /previewVisible && mode !== "edit"/);
  assert.doesNotMatch(editor, /import \{ markdownToHtml/);
});
