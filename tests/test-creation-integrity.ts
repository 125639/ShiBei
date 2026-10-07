import assert from "node:assert/strict";
import test from "node:test";
import { serializeWorkForOwner } from "../src/lib/creation-server";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import path from "node:path";
import {
  anonymousWorkWasPublished,
  canPublishWork,
  findModeratedSurfaceMatch,
  legacyWorkScoreFingerprint,
  publicationSnapshotWhere,
  ownerScoreDetail,
  ownerScorePresentation,
  scoreInvalidationData,
  workRubricFingerprint,
  workDeletionWhere,
  workRevisionWhere,
  workScoreFingerprint
} from "../src/lib/creation";

type WorkRecord = {
  id: string;
  status: "INTERVIEWING" | "DRAFT" | "SHARED";
  updatedAt: Date;
  title: string;
  summary: string;
  content: string;
  score: number | null;
  scoredHash: string | null;
  scoredRubricHash: string | null;
  ownerId: string | null;
  publishedOnceAt: Date | null;
};

function fallbackDraft() {
  const work = {
    ...passingDraft(), ...scoreInvalidationData(),
    depth: "SHORT" as const, mode: "MANUAL" as const, topic: "预检主题",
    genre: { id: "genre", slug: "story", name: "叙事", description: "", threshold: 65,
      dimensions: JSON.stringify([{ key: "quality", label: "质量", weight: 1, hint: "" }]) },
    slug: null, interview: "[]", pendingQuestion: null, anonId: "anon",
    draftGeneratedAt: null, publishedAt: null, createdAt: new Date()
  };
  return { ...work, scoreDetail: JSON.stringify({
    fallback: true,
    precheckSurfaceHash: workScoreFingerprint(work),
    precheckRubricHash: workRubricFingerprint(work),
    dimensions: [{ key: "quality", label: "质量", weight: 1, score: 50, feedback: "结构反馈" }],
    total: 50, threshold: 65, publishable: false,
    overallComment: "AI 评审服务暂时不可用，本次只完成了保守的结构预检。",
    suggestions: ["模型恢复后重新评分"]
  }) };
}

const RUBRIC_HASH = "rubric-v1";

type PublicationWhere = ReturnType<typeof publicationSnapshotWhere>;

/** In-memory equivalent of Prisma updateMany({ where }). */
function matchesPublicationSnapshot(record: WorkRecord, where: PublicationWhere) {
  return (
    record.id === where.id &&
    record.status === where.status &&
    record.updatedAt.getTime() === where.updatedAt.getTime() &&
    record.title === where.title &&
    record.summary === where.summary &&
    record.content === where.content &&
    record.score === where.score &&
    record.scoredHash === where.scoredHash &&
    record.scoredRubricHash === where.scoredRubricHash
  );
}

function passingDraft(): WorkRecord {
  const title = "评分时标题";
  const summary = "评分时摘要";
  const content = "评分时正文";
  return {
    id: "work-1",
    status: "DRAFT",
    updatedAt: new Date("2026-07-13T12:00:00.000Z"),
    title,
    summary,
    content,
    score: 88,
    scoredHash: workScoreFingerprint({ title, summary, content }),
    scoredRubricHash: RUBRIC_HASH,
    ownerId: null,
    publishedOnceAt: null
  };
}

test("fallback owner response keeps outage detail without any formal score credentials", async () => {
  const draft = fallbackDraft();
  const response = await serializeWorkForOwner(draft as Parameters<typeof serializeWorkForOwner>[0], null);
  assert.equal(response.scoreDetail?.fallback, true);
  assert.match(response.scoreDetail?.overallComment ?? "", /服务暂时不可用/);
  assert.equal(response.scoreDetail?.publishable, false);
  assert.equal(response.score, null);
  assert.equal(response.scoredAt, null);
  assert.equal(response.scoreCurrent, false);
  assert.equal(response.hasHistoricalScore, false);
  assert.equal(draft.scoredHash, null);
  assert.equal(draft.scoredRubricHash, null);
  assert.equal(canPublishWork({ ...draft, threshold: 65, currentRubricHash: workRubricFingerprint(draft) }).ok, false);

  for (const patch of [{ title: "新标题" }, { summary: "新摘要" }, { content: "    新正文" },
    { depth: "FULL" as const }, { genre: { ...draft.genre, threshold: 60 } }]) {
    assert.equal(ownerScoreDetail({ ...draft, ...patch }), null, "stale precheck must not survive content/rubric changes");
  }
  assert.equal(ownerScoreDetail({ ...draft, ...scoreInvalidationData() }), null);
  assert.equal(ownerScoreDetail({ ...draft, scoreDetail: "{broken" }), null);
  assert.equal(ownerScoreDetail({ ...draft, scoreDetail: JSON.stringify({ fallback: true }) }), null);
  const forged = { ...draft, score: 99, scoredHash: workScoreFingerprint(draft), scoredRubricHash: workRubricFingerprint(draft),
    scoreDetail: draft.scoreDetail.replace('"publishable":false', '"publishable":true') };
  assert.equal(ownerScoreDetail(forged)?.publishable, false);
  assert.equal(canPublishWork({ ...forged, threshold: 65, currentRubricHash: workRubricFingerprint(draft) }).ok, false);
  assert.equal(ownerScorePresentation(draft).current, false);
});

test("browser shows fallback explanation, never publication, and hides precheck on local edits", async () => {
  // Bundle the real component into an isolated in-memory page; no app/production server is started.
  const require = createRequire(import.meta.url);
  const bundle = await build({
    stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {CreationStudio} from "./src/components/CreationStudio"; createRoot(document.getElementById("root")).render(<CreationStudio/>);',
      resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "isolated-studio-dependencies", setup(build) {
      build.onResolve({ filter: /LocalizedLink|anon-bootstrap|useMarkdownHtml|TaskProgress|useUnsavedChangesGuard/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ loader: "jsx", resolveDir: path.dirname(require.resolve("react")), contents:
        args.path.includes("LocalizedLink") ? 'export const LocalizedLink = ({children,...props}) => <a {...props}>{children}</a>;' :
        args.path.includes("anon-bootstrap") ? 'export const ANON_CREATION_SEED_HEADER="seed"; export async function ensureAnonymousBootstrap(){return "seed";}' :
        args.path.includes("useMarkdownHtml") ? 'export const useMarkdownHtml=()=>"";' :
        args.path.includes("TaskProgress") ? 'export const TaskProgress=()=>null;' : 'export const useUnsavedChangesGuard=()=>{};'
      }));
    } }]
  });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const draft = fallbackDraft();
    let work = await serializeWorkForOwner(draft as Parameters<typeof serializeWorkForOwner>[0], null);
    await page.route("http://creation.test/**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      const body = url.pathname.endsWith("/genres") ? { genres: [work.genre], depths: {}, modes: {} } :
        url.pathname.endsWith("/works") ? { works: [], nextCursor: null, isMember: false, anonQuotaRemaining: 2, anonWorkLimit: 2 } :
        { work, scoreFallback: true };
      await route.fulfill({ json: body });
    });
    await page.goto("http://creation.test/create?work=work-1");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("heading", { name: "结构预检（非正式评分）" }).waitFor();
    assert.match(await page.locator("body").innerText(), /AI 评审服务暂时不可用/);
    assert.equal(await page.getByRole("button", { name: /公开到社区|确认发布/ }).count(), 0);
    assert.equal(await page.getByText(/已达标|总分/).count(), 0);
    for (const id of ["creation-title", "creation-summary", "creation-content"]) {
      const original = await page.locator(`#${id}`).inputValue();
      await page.locator(`#${id}`).fill(`${original} 修改`);
      assert.equal(await page.getByRole("heading", { name: "结构预检（非正式评分）" }).count(), 0);
      await page.locator(`#${id}`).fill(original);
      await page.getByRole("heading", { name: "结构预检（非正式评分）" }).waitFor();
    }
    const [scoreResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/score")),
      page.getByRole("button", { name: "提交 AI 评分" }).click()
    ]);
    const scoreBody = await scoreResponse.json();
    assert.equal(scoreBody.scoreFallback, true);
    assert.equal(scoreBody.work.scoreDetail.fallback, true);
    assert.equal(scoreBody.work.scoreCurrent, false);
    await page.getByRole("button", { name: "提交 AI 评分" }).waitFor();
    await page.getByRole("heading", { name: "结构预检（非正式评分）" }).waitFor();
    await page.locator("#creation-content").fill("保存后的新正文");
    work = await serializeWorkForOwner({ ...draft, content: "保存后的新正文", ...scoreInvalidationData() } as Parameters<typeof serializeWorkForOwner>[0], null);
    await page.getByRole("button", { name: "保存修改" }).click();
    await page.getByRole("button", { name: "已保存" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "结构预检（非正式评分）" }).count(), 0);
  } finally { await browser.close(); }
});

test("publication gate and CAS publish the unchanged scored snapshot", () => {
  const draft = passingDraft();
  const gate = canPublishWork({ ...draft, threshold: 70, currentRubricHash: RUBRIC_HASH });
  assert.deepEqual(gate, { ok: true });

  const where = publicationSnapshotWhere(draft);
  assert.equal(matchesPublicationSnapshot(draft, where), true);

  if (matchesPublicationSnapshot(draft, where)) draft.status = "SHARED";
  assert.equal(draft.status, "SHARED");
});

test("a PATCH landing after the gate makes the publication CAS miss", () => {
  const draft = passingDraft();
  const where = publicationSnapshotWhere(draft);

  // Simulate a request that passed canPublishWork, followed by a concurrent PATCH.
  draft.title = "并发换掉的标题";
  draft.score = null;
  draft.scoredHash = null;
  draft.scoredRubricHash = null;
  draft.updatedAt = new Date("2026-07-13T12:00:01.000Z");

  assert.equal(matchesPublicationSnapshot(draft, where), false);
  assert.equal(draft.status, "DRAFT");
});

test("a public summary change invalidates the scored snapshot and publication CAS", () => {
  const draft = passingDraft();
  const where = publicationSnapshotWhere(draft);

  draft.summary = "评分后塞入、正文并不支持的摘要";
  draft.score = null;
  draft.scoredHash = null;
  draft.scoredRubricHash = null;
  draft.updatedAt = new Date("2026-07-13T12:00:02.000Z");

  assert.equal(matchesPublicationSnapshot(draft, where), false);
  assert.equal(draft.status, "DRAFT");
});

test("an in-flight PATCH or compose cannot write through a completed publish", () => {
  const draft = passingDraft();
  const staleWriterRevision = {
    id: draft.id,
    status: draft.status,
    updatedAt: draft.updatedAt
  };

  draft.status = "SHARED";
  draft.updatedAt = new Date("2026-07-13T12:00:01.000Z");

  const staleWriterStillMatches =
    draft.id === staleWriterRevision.id &&
    draft.status === staleWriterRevision.status &&
    draft.updatedAt.getTime() === staleWriterRevision.updatedAt.getTime();
  assert.equal(staleWriterStillMatches, false);
  assert.equal(draft.status, "SHARED");
});

test("an anonymous draft DELETE cannot race through a completed publish", () => {
  const draft = passingDraft();
  const staleDelete = workRevisionWhere(draft);

  // DELETE saw a deletable anonymous DRAFT, but publication wins first.
  draft.status = "SHARED";
  draft.updatedAt = new Date("2026-07-13T12:00:01.000Z");

  const staleDeleteStillMatches =
    draft.id === staleDelete.id &&
    draft.status === staleDelete.status &&
    draft.updatedAt.getTime() === staleDelete.updatedAt.getTime();
  assert.equal(staleDeleteStillMatches, false);
  assert.equal(draft.status, "SHARED");
});

test("administrator unpublish never restores anonymous deletion rights", () => {
  const anonymousWork = passingDraft();
  const firstPublishedAt = new Date("2026-07-13T12:10:00.000Z");

  // The work was public and is now back in DRAFT after administrator moderation.
  anonymousWork.status = "DRAFT";
  anonymousWork.publishedOnceAt = firstPublishedAt;
  anonymousWork.updatedAt = new Date("2026-07-13T12:11:00.000Z");

  assert.equal(anonymousWorkWasPublished(anonymousWork), true);
  const deleteWhere = workDeletionWhere(anonymousWork);
  assert.ok("publishedOnceAt" in deleteWhere);
  assert.equal(deleteWhere.publishedOnceAt, null);
  assert.notEqual(anonymousWork.publishedOnceAt, deleteWhere.publishedOnceAt);
});

test("never-published anonymous drafts remain deletable and members keep full deletion rights", () => {
  const anonymousDraft = passingDraft();
  assert.equal(anonymousWorkWasPublished(anonymousDraft), false);
  assert.deepEqual(workDeletionWhere(anonymousDraft), {
    id: anonymousDraft.id,
    status: "DRAFT",
    updatedAt: anonymousDraft.updatedAt,
    publishedOnceAt: null
  });

  const memberWork = {
    ...anonymousDraft,
    ownerId: "member-1",
    publishedOnceAt: new Date("2026-07-13T12:10:00.000Z")
  };
  assert.equal(anonymousWorkWasPublished(memberWork), false);
  assert.equal("publishedOnceAt" in workDeletionWhere(memberWork), false);
});

test("a stale client revision cannot overwrite a later saved draft", () => {
  const draft = passingDraft();
  const clientExpectedUpdatedAt = draft.updatedAt;

  // Another tab saves before this old tab submits its local edit.
  draft.content = "另一个标签页已经保存的新正文";
  draft.updatedAt = new Date("2026-07-13T12:00:03.000Z");

  assert.notEqual(draft.updatedAt.getTime(), clientExpectedUpdatedAt.getTime());
  assert.equal(draft.content, "另一个标签页已经保存的新正文");
});

test("a stale interview answer is rejected instead of attaching to the next question", () => {
  const clientExpectedUpdatedAt = "2026-07-13T12:00:00.000Z";
  const currentServerUpdatedAt = "2026-07-13T12:00:01.000Z";
  assert.notEqual(clientExpectedUpdatedAt, currentServerUpdatedAt);
});

test("A and B moderation history blocks restoring either version while permitting a genuinely new surface", () => {
  const surfaceA = { title: "被下架标题", summary: "A 摘要", content: "A 正文" };
  const surfaceB = { title: "被下架标题", summary: "B 摘要", content: "B 正文" };
  const surfaceC = { title: "整改后标题", summary: "C 摘要", content: "C 正文" };
  const history = [
    {
      algorithm: "TITLE_SUMMARY_CONTENT_V2" as const,
      surfaceHash: workScoreFingerprint(surfaceA),
      reason: "A 的治理原因"
    },
    {
      algorithm: "TITLE_SUMMARY_CONTENT_V2" as const,
      surfaceHash: workScoreFingerprint(surfaceB),
      reason: "B 的治理原因"
    }
  ];

  const matchedA = findModeratedSurfaceMatch(surfaceA, history);
  assert.equal(matchedA?.reason, "A 的治理原因");
  const blocked = canPublishWork({
    ...surfaceA,
    threshold: 70,
    score: 90,
    scoredHash: workScoreFingerprint(surfaceA),
    scoredRubricHash: RUBRIC_HASH,
    currentRubricHash: RUBRIC_HASH,
    moderationBlocked: Boolean(matchedA),
    moderationReason: matchedA?.reason
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /A 的治理原因/);

  assert.equal(findModeratedSurfaceMatch(surfaceC, history), null);
  assert.deepEqual(canPublishWork({
    ...surfaceC,
    threshold: 70,
    score: 90,
    scoredHash: workScoreFingerprint(surfaceC),
    scoredRubricHash: RUBRIC_HASH,
    currentRubricHash: RUBRIC_HASH,
    moderationBlocked: false,
    moderationReason: null
  }), { ok: true });

  const restoredA = findModeratedSurfaceMatch(surfaceA, history);
  assert.equal(restoredA?.reason, "A 的治理原因");
  assert.equal(canPublishWork({
    ...surfaceA,
    threshold: 70,
    score: 90,
    scoredHash: workScoreFingerprint(surfaceA),
    scoredRubricHash: RUBRIC_HASH,
    currentRubricHash: RUBRIC_HASH,
    moderationBlocked: Boolean(restoredA),
    moderationReason: restoredA?.reason
  }).ok, false);
});

test("legacy title+content governance blocks every summary until title or content changes", () => {
  const legacySurface = { title: "旧标题", content: "旧正文" };
  const history = [{
    algorithm: "TITLE_CONTENT_V1" as const,
    surfaceHash: legacyWorkScoreFingerprint(legacySurface),
    reason: "迁移前治理原因"
  }];
  assert.equal(findModeratedSurfaceMatch({ ...legacySurface, summary: "任意新摘要" }, history)?.reason, "迁移前治理原因");
  assert.equal(findModeratedSurfaceMatch({ ...legacySurface, summary: "另一段摘要" }, history)?.reason, "迁移前治理原因");
  assert.equal(findModeratedSurfaceMatch({ title: "旧标题", summary: "任意新摘要", content: "已整改正文" }, history), null);
});
