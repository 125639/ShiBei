import assert from "node:assert/strict";
import test from "node:test";
import { findModeratedSurfaceMatch, workScoreFingerprint } from "../src/lib/creation";
import {
  CommunityModerationError,
  CommunityModerationRequestSchema,
  SHARED_COMMUNITY_WORK_WHERE,
  moderateSharedCommunityWork,
  requireCommunityModerator,
  type CommunityModerationAuditInput,
  type CommunityModerationStore
} from "../src/lib/community-moderation";

type FakeWork = {
  id: string;
  status: "DRAFT" | "SHARED";
  title: string;
  summary: string;
  content: string;
  slug: string | null;
  ownerId: string | null;
};

type FakeSourceDocument = {
  creativeWorkId: string | null;
  publicationBlockedAt: Date | null;
};

class FakeModerationStore implements CommunityModerationStore {
  works = new Map<string, FakeWork>();
  moderatedSurfaces = new Map<string, Map<string, {
    algorithm: "TITLE_SUMMARY_CONTENT_V2";
    reason: string;
  }>>();
  sourceDocuments = new Map<string, FakeSourceDocument>();
  audits: CommunityModerationAuditInput[] = [];

  async findSharedWork(id: string) {
    const work = this.works.get(id);
    return work?.status === "SHARED" ? { ...work, status: "SHARED" as const } : null;
  }

  async unpublishSharedWork(id: string, surface: {
    algorithm: "TITLE_SUMMARY_CONTENT_V2";
    surfaceHash: string;
    reason: string;
  }) {
    const work = this.works.get(id);
    if (!work || work.status !== "SHARED") return false;
    const history = this.moderatedSurfaces.get(id) ?? new Map();
    if (!history.has(surface.surfaceHash)) {
      history.set(surface.surfaceHash, { algorithm: surface.algorithm, reason: surface.reason });
    }
    this.moderatedSurfaces.set(id, history);
    this.works.set(id, { ...work, status: "DRAFT", slug: null });
    return true;
  }

  async deleteSharedWork(id: string) {
    const work = this.works.get(id);
    if (!work || work.status !== "SHARED") return false;
    const source = this.sourceDocuments.get(id);
    if (source) {
      this.sourceDocuments.set(id, {
        creativeWorkId: null,
        publicationBlockedAt: new Date("2026-07-13T05:00:00.000Z")
      });
    }
    // Mirrors the database FK's ON DELETE CASCADE retention policy.
    this.moderatedSurfaces.delete(id);
    this.works.delete(id);
    return true;
  }

  async createAudit(data: CommunityModerationAuditInput) {
    this.audits.push(data);
  }
}

test("moderation API identity accepts only an administrator session", () => {
  assert.equal(requireCommunityModerator({ userId: "admin-1" }), "admin-1");

  for (const identity of [null, undefined, {}, { memberId: "member-1" }, { userId: "" }]) {
    assert.throws(
      () => requireCommunityModerator(identity),
      (error) => error instanceof CommunityModerationError && error.status === 401
    );
  }
});

test("moderation list boundary is permanently restricted to SHARED", () => {
  assert.deepEqual(SHARED_COMMUNITY_WORK_WHERE, { status: "SHARED" });
});

test("administrator can unpublish an anonymous SHARED work and writes its audit snapshot", async () => {
  const store = new FakeModerationStore();
  store.sourceDocuments.set("anon-work", {
    creativeWorkId: "anon-work",
    publicationBlockedAt: null
  });
  store.works.set("anon-work", {
    id: "anon-work",
    status: "SHARED",
    title: "公开时标题",
    summary: "公开时摘要",
    content: "公开时正文",
    slug: "public-title-abc123",
    ownerId: null
  });

  await moderateSharedCommunityWork({
    adminId: "admin-1",
    workId: "anon-work",
    action: "UNPUBLISH",
    reason: "包含需要核实的违规事实",
    store
  });

  assert.deepEqual(store.works.get("anon-work"), {
    id: "anon-work",
    status: "DRAFT",
    title: "公开时标题",
    summary: "公开时摘要",
    content: "公开时正文",
    slug: null,
    ownerId: null
  });
  assert.deepEqual(
    [...(store.moderatedSurfaces.get("anon-work") ?? new Map()).entries()],
    [[
      workScoreFingerprint({ title: "公开时标题", summary: "公开时摘要", content: "公开时正文" }),
      { algorithm: "TITLE_SUMMARY_CONTENT_V2", reason: "包含需要核实的违规事实" }
    ]]
  );
  assert.deepEqual(store.audits, [{
    adminId: "admin-1",
    action: "UNPUBLISH",
    reason: "包含需要核实的违规事实",
    targetWorkId: "anon-work",
    titleSnapshot: "公开时标题",
    summarySnapshot: "公开时摘要",
    slugSnapshot: "public-title-abc123",
    wasAnonymous: true
  }]);
  assert.deepEqual(store.sourceDocuments.get("anon-work"), {
    creativeWorkId: "anon-work",
    publicationBlockedAt: null
  }, "下架必须保留手写源文档绑定");
});

test("permanent deletion preserves the public work snapshot in the audit log", async () => {
  const store = new FakeModerationStore();
  store.sourceDocuments.set("member-work", {
    creativeWorkId: "member-work",
    publicationBlockedAt: null
  });
  store.works.set("member-work", {
    id: "member-work",
    status: "SHARED",
    title: "违规作品",
    summary: "违规摘要",
    content: "违规正文",
    slug: "bad-work-xyz789",
    ownerId: "member-1"
  });
  store.moderatedSurfaces.set("member-work", new Map([[
    "old-surface",
    { algorithm: "TITLE_SUMMARY_CONTENT_V2", reason: "旧治理原因" }
  ]]));

  await moderateSharedCommunityWork({
    adminId: "admin-2",
    workId: "member-work",
    action: "DELETE",
    reason: "确认违反社区规则",
    store
  });

  assert.equal(store.works.has("member-work"), false);
  assert.equal(store.moderatedSurfaces.has("member-work"), false, "作品删除后治理表面按 FK 策略级联删除");
  const retainedSource = store.sourceDocuments.get("member-work");
  assert.equal(retainedSource?.creativeWorkId, null, "删除公开副本后 FK 应解除绑定");
  assert.ok(retainedSource?.publicationBlockedAt instanceof Date, "私有原稿必须保留并写入交接锁");
  assert.equal(store.audits[0].targetWorkId, "member-work");
  assert.equal(store.audits[0].titleSnapshot, "违规作品");
  assert.equal(store.audits[0].summarySnapshot, "违规摘要");
  assert.equal(store.audits[0].slugSnapshot, "bad-work-xyz789");
  assert.equal(store.audits[0].wasAnonymous, false);
});

test("A then B moderation history still blocks restoring A without exposing B's reason", async () => {
  const store = new FakeModerationStore();
  const workId = "history-work";
  const surfaceA = { title: "同一标题", summary: "版本 A 摘要", content: "版本 A 正文" };
  const surfaceB = { title: "同一标题", summary: "版本 B 摘要", content: "版本 B 正文" };
  store.works.set(workId, {
    id: workId,
    status: "SHARED",
    ...surfaceA,
    slug: "history-a",
    ownerId: "member-1"
  });

  await moderateSharedCommunityWork({
    adminId: "admin-1",
    workId,
    action: "UNPUBLISH",
    reason: "A 的治理原因",
    store
  });
  store.works.set(workId, {
    id: workId,
    status: "SHARED",
    ...surfaceB,
    slug: "history-b",
    ownerId: "member-1"
  });
  await moderateSharedCommunityWork({
    adminId: "admin-2",
    workId,
    action: "UNPUBLISH",
    reason: "B 的治理原因",
    store
  });

  const history = [...(store.moderatedSurfaces.get(workId) ?? new Map()).entries()]
    .map(([surfaceHash, record]) => ({
      algorithm: record.algorithm,
      surfaceHash,
      reason: record.reason
    }));
  assert.equal(history.length, 2);
  assert.deepEqual(findModeratedSurfaceMatch(surfaceA, history), {
    algorithm: "TITLE_SUMMARY_CONTENT_V2",
    surfaceHash: workScoreFingerprint(surfaceA),
    reason: "A 的治理原因"
  });
  assert.deepEqual(findModeratedSurfaceMatch(surfaceB, history), {
    algorithm: "TITLE_SUMMARY_CONTENT_V2",
    surfaceHash: workScoreFingerprint(surfaceB),
    reason: "B 的治理原因"
  });
});

test("private drafts cannot be discovered or governed and create no audit record", async () => {
  const store = new FakeModerationStore();
  store.works.set("private-work", {
    id: "private-work",
    status: "DRAFT",
    title: "私密标题",
    summary: "私密摘要",
    content: "私密正文",
    slug: null,
    ownerId: "member-1"
  });

  await assert.rejects(
    moderateSharedCommunityWork({
      adminId: "admin-1",
      workId: "private-work",
      action: "DELETE",
      reason: "不应允许",
      store
    }),
    (error) => error instanceof CommunityModerationError && error.status === 404
  );
  assert.equal(store.works.has("private-work"), true);
  assert.deepEqual(store.audits, []);
});

test("reason validation is enforced before any governance mutation", async () => {
  assert.equal(CommunityModerationRequestSchema.safeParse({ action: "DELETE", reason: "" }).success, false);
  assert.equal(CommunityModerationRequestSchema.safeParse({ action: "DELETE", reason: "  合法原因  " }).success, true);

  const store = new FakeModerationStore();
  store.works.set("public-work", {
    id: "public-work",
    status: "SHARED",
    title: "作品",
    summary: "摘要",
    content: "正文",
    slug: "work-123456",
    ownerId: null
  });
  await assert.rejects(
    moderateSharedCommunityWork({
      adminId: "admin-1",
      workId: "public-work",
      action: "UNPUBLISH",
      reason: "x",
      store
    }),
    (error) => error instanceof CommunityModerationError && error.status === 400
  );
  assert.equal(store.works.get("public-work")?.status, "SHARED");
  assert.deepEqual(store.audits, []);
});
