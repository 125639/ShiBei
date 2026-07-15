/**
 * 真实 HTTP 验证纯手写的完整交接链路、并发幂等与身份隔离。
 *
 * 用法：BASE_URL=http://127.0.0.1:3200 node scripts/e2e/verify-manual-writing-flow.mjs
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const prisma = new PrismaClient();
const createdDocIds = new Set();
const createdWorkIds = new Set();
let checks = 0;

function pass(label) {
  checks += 1;
  console.log(`PASS  ${label}`);
}

class HttpSession {
  cookies = new Map();

  async request(path, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("Origin", BASE);
    if (this.cookies.size) {
      headers.set("Cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    }
    const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
    const values = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      const first = value.split(";", 1)[0];
      const separator = first.indexOf("=");
      if (separator < 1) continue;
      const key = first.slice(0, separator).trim();
      const cookieValue = first.slice(separator + 1).trim();
      if (cookieValue) this.cookies.set(key, cookieValue);
      else this.cookies.delete(key);
    }
    return response;
  }

  async json(path, init = {}, expectedStatus = 200) {
    const response = await this.request(path, init);
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    assert.equal(
      response.status,
      expectedStatus,
      `${init.method || "GET"} ${path}: expected ${expectedStatus}, got ${response.status}: ${text}`
    );
    return body;
  }

  async bootstrapAnonymousIdentity() {
    return this.json("/api/public/anon/bootstrap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-shibei-anon-bootstrap": "1"
      },
      body: JSON.stringify({ seed: randomUUID() })
    });
  }
}

function jsonPost(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function runOnce(iteration, genreId) {
  const owner = new HttpSession();
  const stranger = new HttpSession();
  const marker = `manual-e2e-${Date.now()}-${iteration}`;
  const title = `纯手写交接验收 ${iteration}`;
  const content = `  ${marker} 第一段。\n\n\`\`\`text\n  保留代码缩进\n\`\`\`\n\n结尾空格保留。   \n`;

  await Promise.all([
    owner.bootstrapAnonymousIdentity(),
    stranger.bootstrapAnonymousIdentity()
  ]);
  const created = await owner.json("/api/public/writing/docs", { method: "POST" });
  const docId = created.doc.id;
  createdDocIds.add(docId);
  assert.ok(owner.cookies.size > 0, "匿名创建文档必须建立浏览器身份 cookie");

  const invisible = await stranger.request(`/api/public/writing/docs/${docId}`);
  assert.equal(invisible.status, 404, "另一匿名身份不得读取私有手稿");
  pass(`第 ${iteration} 轮：匿名手稿对其他访客严格不可见`);

  const patched = await owner.json(`/api/public/writing/docs/${docId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedUpdatedAt: created.doc.updatedAt,
      title,
      content
    })
  });
  const loaded = await owner.json(`/api/public/writing/docs/${docId}`);
  assert.equal(patched.doc.updatedAt, loaded.doc.updatedAt);
  assert.equal(loaded.doc.content, content, "正文首尾空白与 Markdown 必须逐字保存");
  assert.equal(loaded.doc.title, title);
  pass(`第 ${iteration} 轮：纯手写正文原样自动保存`);

  const completed = await owner.json(
    `/api/public/writing/docs/${docId}/complete`,
    jsonPost({})
  );
  assert.ok(completed.doc.completedAt, "完成动作必须返回完成时间");
  assert.equal(completed.doc.content, content);
  pass(`第 ${iteration} 轮：完成后能进入预览且不改写正文`);

  const handoffInput = {
    genreId,
    depth: iteration % 2 === 0 ? "FULL" : "SHORT",
    expectedUpdatedAt: completed.doc.updatedAt
  };
  const handoffs = await Promise.all(
    Array.from({ length: 4 }, () => owner.json(
      `/api/public/writing/docs/${docId}/community-draft`,
      jsonPost(handoffInput)
    ))
  );
  const workIds = new Set(handoffs.map((item) => item.workId));
  assert.equal(workIds.size, 1, "四个并发‘下一步’请求只能得到一个作品");
  const workId = handoffs[0].workId;
  createdWorkIds.add(workId);
  assert.ok(handoffs.some((item) => item.created === true));
  assert.ok(handoffs.some((item) => item.created === false));
  assert.ok(handoffs.every((item) => item.url === `/create?work=${workId}`));

  const ownedWork = await owner.json(`/api/public/creation/works/${workId}`);
  assert.equal(ownedWork.work.mode, "MANUAL");
  assert.equal(ownedWork.work.status, "DRAFT");
  assert.equal(ownedWork.work.title, title);
  assert.equal(ownedWork.work.content, content);
  assert.equal(ownedWork.work.interview.length, 0);
  assert.equal(ownedWork.work.pendingQuestion, null);
  assert.equal(ownedWork.work.score, null);
  const databaseWork = await prisma.creativeWork.findUniqueOrThrow({ where: { id: workId } });
  assert.equal(databaseWork.draftGeneratedAt, null, "纯手写交接不得伪装成 AI 成稿");
  assert.equal(databaseWork.ownerId, null);
  assert.ok(databaseWork.anonId);
  pass(`第 ${iteration} 轮：下一步并发幂等，并完整进入评分与发布草稿`);

  const strangerWork = await stranger.request(`/api/public/creation/works/${workId}`);
  assert.equal(strangerWork.status, 404, "其他访客不得读取交接后的私有作品");
  const sourceEdit = await owner.request(`/api/public/writing/docs/${docId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedUpdatedAt: completed.doc.updatedAt,
      content: "不允许从旧来源回写"
    })
  });
  assert.equal(sourceEdit.status, 409, "交接后旧手稿必须成为只读来源");

  const answer = await owner.request(
    `/api/public/creation/works/${workId}/answer`,
    jsonPost({ answer: "不应调用", expectedUpdatedAt: ownedWork.work.updatedAt })
  );
  assert.equal(answer.status, 409, "纯手写作品不得进入 AI 访谈");
  const compose = await owner.request(
    `/api/public/creation/works/${workId}/compose`,
    jsonPost({ expectedUpdatedAt: ownedWork.work.updatedAt })
  );
  assert.equal(compose.status, 409, "纯手写作品不得调用 AI 成稿");
  pass(`第 ${iteration} 轮：交接后来源锁定、AI 访谈和 AI 成稿均无法旁路`);

  const docCount = await prisma.writingDoc.count({ where: { creativeWorkId: workId } });
  const workCount = await prisma.creativeWork.count({ where: { id: workId } });
  assert.equal(docCount, 1);
  assert.equal(workCount, 1);
}

async function cleanup() {
  if (createdDocIds.size) {
    await prisma.writingDoc.deleteMany({ where: { id: { in: [...createdDocIds] } } }).catch(() => undefined);
  }
  if (createdWorkIds.size) {
    await prisma.creativeWork.deleteMany({ where: { id: { in: [...createdWorkIds] } } }).catch(() => undefined);
  }
}

try {
  const genres = await fetch(`${BASE}/api/public/creation/genres`).then(async (response) => {
    const raw = await response.text();
    assert.equal(response.status, 200, raw);
    return JSON.parse(raw);
  });
  const genreId = genres.genres?.[0]?.id;
  assert.ok(genreId, "验收库必须至少有一个启用题材");

  await runOnce(1, genreId);
  await runOnce(2, genreId);
  console.log(`\nAll ${checks} real manual-writing checks passed.`);
} finally {
  await cleanup();
  await prisma.$disconnect();
}
