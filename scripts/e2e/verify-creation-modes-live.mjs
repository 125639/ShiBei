/**
 * 使用站点真实模型配置走完两种 AI 共创模式：访谈→成稿→评分→发布→公开读取→删除。
 * 不 mock 任何 API 或模型响应；测试账号、题材和作品在 finally 中清理。
 *
 * 用法：BASE_URL=http://127.0.0.1:3200 node scripts/e2e/verify-creation-modes-live.mjs
 */
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3200").replace(/\/$/, "");
const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const username = `e2e_ai_${suffix}`.slice(0, 60);
const password = `E2e!${suffix}Aa9`;
let memberId = "";
let genreId = "";
const workIds = new Set();
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
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers,
      redirect: "manual",
      // Compose performs interpretation, drafting and review in sequence. Each
      // provider call has its own stricter interactive timeout; the route-level
      // client must allow the full multi-stage pipeline to finish or degrade.
      signal: init.signal || AbortSignal.timeout(600_000)
    });
    const setCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    for (const item of setCookies) {
      const first = item.split(";", 1)[0];
      const split = first.indexOf("=");
      if (split < 1) continue;
      const key = first.slice(0, split).trim();
      const value = first.slice(split + 1).trim();
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { status: response.status, headers: response.headers, body, text };
  }
}

function post(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function assertPublicPageGone(path, forbiddenText) {
  const response = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.text();
  if (response.status !== 404) {
    assert.equal(response.status, 200);
    assert.match(body, /NEXT_HTTP_ERROR_FALLBACK;404/);
    assert.match(body, /<meta name="robots" content="noindex"/);
  }
  for (const value of forbiddenText) {
    assert.equal(body.includes(value), false, `删除后的公开页仍包含作品内容：${value}`);
  }
}

async function modelCall(session, path, body, label, attempts = 3) {
  let latest;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    latest = await session.request(path, post(body));
    if (latest.status !== 502) return latest;
    console.log(`RETRY ${label}: model returned 502 (${attempt}/${attempts})`);
    await delay(attempt * 1_000);
  }
  return latest;
}

function answerFor(question, index, mode) {
  const modeSentence = mode === "VOICE_FIRST"
    ? "我希望保留一句原话：慢一点并不等于退步，亲手校正的过程本身就是答案。"
    : "请把材料重新组织成清晰的起因、转折、行动和反思，不必沿用我的句序。";
  return [
    `这是一次只属于我的私人木工经历（第 ${index + 1} 个回答），不涉及需要联网核实的公共事实。`,
    `针对“${question}”，当时我先画错了尺寸，装配时才发现两块侧板相差约一指宽。`,
    "我没有掩饰失误，而是拆下连接件、重新测量，在废木片上先做了一次试装；最难的是承认急于完成反而浪费了时间。",
    "最终书架能够稳定使用，但真正留下来的不是成品，而是先验证再下刀、遇到错误先停下来的习惯。",
    modeSentence
  ].join("\n");
}

async function runMode(session, mode, depth) {
  const label = `${mode}/${depth}`;
  const started = await modelCall(
    session,
    "/api/public/creation/works",
    {
      genreId,
      mode,
      depth,
      topic: `我第一次独自做木工书架的失误、修正与反思（${label}）`
    },
    `${label} 开始访谈`
  );
  assert.equal(started.status, 200, `${label} start failed: ${started.text}`);
  let work = started.body.work;
  let usedQuestionFallback = Boolean(started.body.questionFallback);
  workIds.add(work.id);
  assert.equal(work.mode, mode);
  assert.equal(work.depth, depth);
  assert.equal(work.status, "INTERVIEWING");
  assert.ok(work.pendingQuestion);
  pass(`${label}：${usedQuestionFallback ? "供应商故障时启用透明内置提纲" : "真实模型生成首个访谈问题"}`);

  let answerCount = 0;
  while (work.pendingQuestion) {
    assert.ok(answerCount < work.maxQuestions + 3, `${label} interview did not terminate`);
    const answered = await modelCall(
      session,
      `/api/public/creation/works/${work.id}/answer`,
      {
        answer: answerFor(work.pendingQuestion, answerCount, mode),
        expectedUpdatedAt: work.updatedAt
      },
      `${label} 回答 ${answerCount + 1}`
    );
    assert.equal(answered.status, 200, `${label} answer failed: ${answered.text}`);
    work = answered.body.work;
    usedQuestionFallback ||= Boolean(answered.body.questionFallback);
    answerCount += 1;
  }
  assert.ok(answerCount >= work.minQuestions);
  assert.ok(answerCount <= work.maxQuestions);
  assert.equal(work.interview.length, answerCount);
  pass(`${label}：完成 ${answerCount} 轮访谈，问题数边界正确${usedQuestionFallback ? "（含故障提纲）" : ""}`);

  // 联网核验若要求澄清，按正常产品流程回答后重新成稿；私人经历通常不会进入这里。
  let composeFallback = false;
  for (let composeRound = 0; composeRound < 3; composeRound += 1) {
    const composed = await modelCall(
      session,
      `/api/public/creation/works/${work.id}/compose`,
      { expectedUpdatedAt: work.updatedAt },
      `${label} 成稿`
    );
    if (composed.status === 200) {
      work = composed.body.work;
      composeFallback = Boolean(composed.body.composeFallback);
      break;
    }
    if (composed.status === 409 && composed.body?.work?.pendingQuestion) {
      work = composed.body.work;
      const clarified = await modelCall(
        session,
        `/api/public/creation/works/${work.id}/answer`,
        {
          answer: "这是我的私人回忆与个人感受，不主张可验证的公共事实；人物均使用泛称，也没有引用外部数字或来源。",
          expectedUpdatedAt: work.updatedAt
        },
        `${label} 核验澄清`
      );
      assert.equal(clarified.status, 200, `${label} clarification failed: ${clarified.text}`);
      work = clarified.body.work;
      continue;
    }
    assert.fail(`${label} compose failed: ${composed.status} ${composed.text}`);
  }
  assert.equal(work.status, "DRAFT", `${label} did not reach draft state`);
  assert.ok(work.title.trim().length > 0);
  assert.ok(work.summary.trim().length > 0);
  assert.ok(work.content.trim().length > 100);
  assert.ok(work.draftGeneratedAt);
  pass(`${label}：${composeFallback ? "供应商故障时生成不扩写保底草稿" : "真实成稿包含标题、摘要和正文"}，并保持私有草稿状态`);

  const scored = await modelCall(
    session,
    `/api/public/creation/works/${work.id}/score`,
    { expectedUpdatedAt: work.updatedAt },
    `${label} 评分`
  );
  assert.equal(scored.status, 200, `${label} score failed: ${scored.text}`);
  work = scored.body.work;
  assert.equal(typeof work.score, "number");
  assert.ok(Number.isFinite(work.score));
  assert.equal(work.scoreDetail.publishable, true, `${label} temporary threshold should be publishable`);
  assert.ok(work.scoreDetail.dimensions.length === 3);
  if (scored.body.scoreFallback) {
    assert.ok(work.score <= 69);
    assert.match(work.scoreDetail.overallComment, /未把临时检查冒充正式 AI 评分/);
  }
  pass(`${label}：${scored.body.scoreFallback ? "供应商故障时保守预检" : "AI 评分"}覆盖三项标尺并绑定当前草稿`);

  const published = await session.request(
    `/api/public/creation/works/${work.id}/publish`,
    post({ expectedUpdatedAt: work.updatedAt })
  );
  assert.equal(published.status, 200, `${label} publish failed: ${published.text}`);
  work = published.body.work;
  assert.equal(work.status, "SHARED");
  assert.ok(work.slug);
  const publicPage = await fetch(`${BASE}${published.body.url}`, {
    signal: AbortSignal.timeout(30_000)
  });
  const publicHtml = await publicPage.text();
  assert.equal(publicPage.status, 200);
  assert.match(publicHtml, new RegExp(work.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  pass(`${label}：通过评分闸门后公开页可立即读取`);

  const removed = await session.request(
    `/api/public/creation/works/${work.id}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: work.updatedAt })
    }
  );
  assert.equal(removed.status, 200, `${label} delete failed: ${removed.text}`);
  workIds.delete(work.id);
  const privateAfterDelete = await session.request(`/api/public/creation/works/${work.id}`);
  assert.equal(privateAfterDelete.status, 404);
  await assertPublicPageGone(published.body.url, [work.title, work.summary, work.content]);
  pass(`${label}：登录作者可删除公开作品，私有 API 与社区页同步消失`);
}

async function cleanup() {
  if (workIds.size) {
    await prisma.writingDoc.deleteMany({ where: { creativeWorkId: { in: [...workIds] } } }).catch(() => undefined);
    await prisma.creativeWork.deleteMany({ where: { id: { in: [...workIds] } } }).catch(() => undefined);
  }
  if (memberId) {
    await prisma.memberUser.deleteMany({ where: { id: memberId } }).catch(() => undefined);
  }
  if (genreId) {
    await prisma.creationGenre.deleteMany({ where: { id: genreId } }).catch(() => undefined);
  }
}

try {
  const member = await prisma.memberUser.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      credentialState: "ACTIVE",
      displayName: "AI 模式真实验收"
    }
  });
  memberId = member.id;
  const genre = await prisma.creationGenre.create({
    data: {
      slug: `e2e-personal-reflection-${suffix}`,
      name: "私人经历与反思（验收）",
      description: "以亲身经历、具体行动和诚实反思形成完整叙事。",
      dimensions: JSON.stringify([
        { key: "specificity", label: "具体性", weight: 0.34, hint: "包含可感知的场景与行动" },
        { key: "coherence", label: "连贯性", weight: 0.33, hint: "结构清楚、前后连贯" },
        { key: "reflection", label: "反思", weight: 0.33, hint: "从经历中形成真诚认识" }
      ]),
      // 临时题材仍调用真实评分，但避免测试文风偏好阻断发布链路验收。
      threshold: 1,
      sortOrder: 999_999,
      isEnabled: true
    }
  });
  genreId = genre.id;

  const session = new HttpSession();
  const login = await session.request("/api/member/login", post({ account: username, secret: password }));
  assert.equal(login.status, 200, `login failed: ${login.text}`);
  assert.equal(login.body.member.id, memberId);
  pass("测试会员通过真实前台会员会话登录");

  await runMode(session, "VOICE_FIRST", "SHORT");
  await runMode(session, "AI_FIRST", "FULL");
  console.log(`\nAll ${checks} live-model creation checks passed.`);
} finally {
  await cleanup();
  await prisma.$disconnect();
}
