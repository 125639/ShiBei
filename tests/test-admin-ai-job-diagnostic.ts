import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { AdminAiJobDiagnostic } from "../src/components/AdminAiJobDiagnostic";
import type { JobStatus } from "@prisma/client";

function render(status: JobStatus, error: string | null) {
  return renderToStaticMarkup(createElement(AdminAiJobDiagnostic, { job: { id: "job-1", status, error } }));
}

test("failed research exposes its real error and a link to untruncated details", () => {
  const html = render("FAILED", "供应商返回 HTTP 400：credit insufficient balance");
  assert.match(html, /失败原因：/);
  assert.match(html, /credit insufficient balance/);
  assert.match(html, /href="\/admin\/jobs\/job-1"/);
  assert.match(html, /View full details/);
});

test("queued retries expose the previous failure without claiming execution or final failure", () => {
  const html = render("QUEUED", "第 1/3 次尝试失败，将自动重试：HTTP 503");
  assert.match(html, /重试信息：/);
  assert.match(html, /HTTP 503/);
  assert.doesNotMatch(html, /失败原因：/);
  assert.equal(render("QUEUED", null), "");
});

test("missing failure records are explicit and completed repair results are not errors", () => {
  assert.match(render("FAILED", null), /未记录错误/);
  assert.match(render("FAILED", "  "), /未记录错误/);
  assert.equal(render("COMPLETED", "首次检查通过并已发布"), "");
  assert.equal(render("RUNNING", "old failure"), "");
});

test("untrusted provider errors are rendered as text, never HTML", () => {
  const html = render("FAILED", '<script>alert("x")</script>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("batch UI mounts diagnostics and no longer treats stale state as proof of execution", () => {
  const source = readFileSync(new URL("../src/components/AdminAiManager.tsx", import.meta.url), "utf8");
  assert.match(source, /<AdminAiJobDiagnostic job=\{job\}/);
  assert.match(source, /setBatchRefreshFailed\(true\)/);
  assert.match(source, /setBatchRefreshFailed\(false\)/);
  assert.match(source, /任务状态刷新失败/);
  assert.match(source, /最近心跳/);
  assert.doesNotMatch(source, /\.toLocale(?:Time)?String\(/);
  assert.match(source, /batchStatus: JobStatus = running \? "RUNNING" : queued \? "QUEUED"/);
  assert.doesNotMatch(source, /即未停止|means the batch has not stopped|等待前序任务/);
});
