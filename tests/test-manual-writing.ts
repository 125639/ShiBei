import assert from "node:assert/strict";
import test from "node:test";
import {
  ManualCommunityDraftSchema,
  ManualWritingError,
  ManualWritingHandoffRaceError,
  deriveManualSummary,
  handoffManualWritingDocument,
  validateManualWritingDocument,
  validateManualWritingPreview,
  type ManualWorkCreateInput,
  type ManualWorkRecord,
  type ManualWritingDocument,
  type ManualWritingHandoffStore
} from "../src/lib/manual-writing";
import {
  MAX_SCORABLE_WORK_CONTENT_LENGTH,
  MAX_WRITING_DOC_CONTENT_LENGTH
} from "../src/lib/creation-limits";

function document(overrides: Partial<ManualWritingDocument> = {}): ManualWritingDocument {
  return {
    id: "doc-1",
    title: "我的手写文章",
    content: "这是完全由我写下的正文。",
    ownerId: "member-1",
    anonId: null,
    creativeWorkId: null,
    publicationBlockedAt: null,
    ...overrides
  };
}

function fakeStore() {
  const works = new Map<string, ManualWorkRecord>();
  const links = new Map<string, string>();
  const creates: ManualWorkCreateInput[] = [];
  let nextId = 1;
  const store: ManualWritingHandoffStore = {
    async findWork(id) {
      return works.get(id) || null;
    },
    async createWork(data) {
      creates.push(data);
      const work: ManualWorkRecord = {
        id: `work-${nextId++}`,
        mode: data.mode,
        status: data.status,
        slug: null
      };
      works.set(work.id, work);
      return work;
    },
    async linkDocumentIfUnlinked(documentId, workId) {
      if (links.has(documentId)) return false;
      links.set(documentId, workId);
      return true;
    }
  };
  return { store, works, links, creates };
}

test("manual completion validates the publishable snapshot without calling AI", () => {
  assert.deepEqual(
    validateManualWritingDocument({ title: "  标题  ", content: "  正文  " }),
    { title: "标题", content: "  正文  " }
  );
  assert.throws(
    () => validateManualWritingDocument({ title: "", content: "正文" }),
    (error: unknown) => error instanceof ManualWritingError && error.status === 400 && /标题/.test(error.message)
  );
  assert.throws(
    () => validateManualWritingDocument({ title: "标题", content: "" }),
    (error: unknown) => error instanceof ManualWritingError && /正文/.test(error.message)
  );
  assert.equal(ManualCommunityDraftSchema.safeParse({
    genreId: "g1",
    depth: "SHORT",
    expectedUpdatedAt: "2026-07-13T12:00:00.000Z"
  }).success, true);
  assert.equal(ManualCommunityDraftSchema.safeParse({
    genreId: "g1",
    depth: "MANUAL",
    expectedUpdatedAt: "2026-07-13T12:00:00.000Z"
  }).success, false);
});

test("manual validation measures and returns the author's raw body verbatim", () => {
  const exact = "\n  第一行  \n\n```text\n  code  \n```\n  ";
  assert.equal(validateManualWritingDocument({ title: "标题", content: exact }).content, exact);
  assert.equal(
    validateManualWritingDocument({
      title: "标题",
      content: `正文${" ".repeat(MAX_SCORABLE_WORK_CONTENT_LENGTH - 2)}`
    }).content.length,
    MAX_SCORABLE_WORK_CONTENT_LENGTH
  );
  assert.throws(
    () => validateManualWritingDocument({
      title: "标题",
      content: `正文${" ".repeat(MAX_SCORABLE_WORK_CONTENT_LENGTH - 1)}`
    }),
    (error: unknown) => error instanceof ManualWritingError && /30000/.test(error.message)
  );

  // 超长私稿仍能完成并预览/导出，只禁止进入无法覆盖全文的评分链路。
  const longPrivateDraft = `正文${" ".repeat(MAX_WRITING_DOC_CONTENT_LENGTH - 2)}`;
  assert.equal(
    validateManualWritingPreview({ title: "长文", content: longPrivateDraft }).content.length,
    MAX_WRITING_DOC_CONTENT_LENGTH
  );
  assert.throws(
    () => validateManualWritingPreview({ title: "长文", content: `${longPrivateDraft}x` }),
    (error: unknown) => error instanceof ManualWritingError && /200000/.test(error.message)
  );
});

test("manual summary preserves author wording while removing markdown furniture", () => {
  const summary = deriveManualSummary([
    "## 小标题",
    "",
    "这是 **我的判断**，详见[原始资料](https://example.com)。",
    "",
    "- 第一点"
  ].join("\n"));
  assert.equal(summary, "小标题 这是 我的判断，详见原始资料。 第一点");
});

test("first handoff creates one MANUAL DRAFT from server-owned document fields", async () => {
  const fake = fakeStore();
  const result = await handoffManualWritingDocument({
    document: document(),
    genreId: "genre-1",
    depth: "SHORT",
    clientIp: "203.0.113.8",
    store: fake.store
  });

  assert.equal(result.created, true);
  assert.equal(result.work.id, "work-1");
  assert.equal(fake.links.get("doc-1"), "work-1");
  assert.equal(fake.creates.length, 1);
  assert.deepEqual(fake.creates[0], {
    ownerId: "member-1",
    anonId: null,
    clientIp: "203.0.113.8",
    genreId: "genre-1",
    mode: "MANUAL",
    depth: "SHORT",
    status: "DRAFT",
    topic: "我的手写文章",
    interview: "[]",
    pendingQuestion: null,
    title: "我的手写文章",
    summary: "这是完全由我写下的正文。",
    content: "这是完全由我写下的正文。",
    draftGeneratedAt: null
  });
});

test("handoff preserves leading, trailing, and repeated newlines byte-for-byte", async () => {
  const fake = fakeStore();
  const exact = "\n  作者保留的开头空白\n\n\n结尾也保留  \n";
  await handoffManualWritingDocument({
    document: document({ content: exact }),
    genreId: "genre-1",
    depth: "FULL",
    clientIp: null,
    store: fake.store
  });

  assert.equal(fake.creates[0]?.content, exact);
  assert.equal(fake.creates[0]?.content.length, exact.length);
});

test("repeat handoff returns the existing work and never overwrites or creates another", async () => {
  const fake = fakeStore();
  fake.works.set("work-existing", {
    id: "work-existing",
    mode: "MANUAL",
    status: "DRAFT",
    slug: null
  });

  const result = await handoffManualWritingDocument({
    // 即使旧 WritingDoc 内容与作品不同，也只返回既有作品。
    document: document({ creativeWorkId: "work-existing", content: "不得覆盖作品的旧快照" }),
    genreId: "another-genre",
    depth: "FULL",
    clientIp: null,
    store: fake.store
  });

  assert.equal(result.created, false);
  assert.equal(result.work.id, "work-existing");
  assert.equal(fake.creates.length, 0);
});

test("a moderated private source remains readable but cannot create another community draft", async () => {
  const fake = fakeStore();
  await assert.rejects(
    handoffManualWritingDocument({
      document: document({ publicationBlockedAt: new Date("2026-07-13T05:00:00.000Z") }),
      genreId: "genre-1",
      depth: "SHORT",
      clientIp: null,
      store: fake.store
    }),
    (error: unknown) =>
      error instanceof ManualWritingError &&
      error.status === 409 &&
      /社区交接已锁定/.test(error.message)
  );
  assert.equal(fake.creates.length, 0);
  assert.equal(fake.links.size, 0);
});

test("a lost conditional-link race throws so the enclosing DB transaction rolls back creation", async () => {
  const fake = fakeStore();
  fake.links.set("doc-1", "winner-work");
  await assert.rejects(
    handoffManualWritingDocument({
      document: document(),
      genreId: "genre-1",
      depth: "SHORT",
      clientIp: null,
      store: fake.store
    }),
    ManualWritingHandoffRaceError
  );
  assert.equal(fake.creates.length, 1, "路由必须回滚事务内创建的作品");
});

test("an existing non-manual binding is rejected", async () => {
  const fake = fakeStore();
  fake.works.set("wrong-work", { id: "wrong-work", mode: "AI_FIRST", status: "DRAFT", slug: null });
  await assert.rejects(
    handoffManualWritingDocument({
      document: document({ creativeWorkId: "wrong-work" }),
      genreId: "genre-1",
      depth: "SHORT",
      clientIp: null,
      store: fake.store
    }),
    (error: unknown) => error instanceof ManualWritingError && error.status === 409
  );
});
