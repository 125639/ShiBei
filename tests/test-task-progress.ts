import assert from "node:assert/strict";
import { clampProgress, getBatchProgress } from "../src/lib/task-progress";

assert.deepEqual(getBatchProgress([]), { settled: 0, total: 0, percent: 0 });
assert.deepEqual(
  getBatchProgress(["COMPLETED", "RUNNING", "QUEUED", "FAILED"]),
  { settled: 2, total: 4, percent: 50 }
);
assert.deepEqual(
  getBatchProgress(["COMPLETED", "FAILED"]),
  { settled: 2, total: 2, percent: 100 },
  "失败任务也应计入已经结束的工作量"
);

assert.equal(clampProgress(-3, 10), 0);
assert.equal(clampProgress(12, 10), 10);
assert.equal(clampProgress(4, 10), 4);
assert.equal(clampProgress(Number.NaN, 10), 0);

console.log("task progress tests passed");
