import assert from "node:assert/strict";
import test from "node:test";
import { publicationData } from "../src/lib/publication-policy";

test("failed generation remains a draft even when auto-publish is on", () => {
  const result = publicationData(true, false, new Date("2026-07-11T00:00:00Z"));
  assert.deepEqual(result, { status: "DRAFT", publishedAt: null });
});

test("only a publishable result inherits auto-publish", () => {
  const now = new Date("2026-07-11T00:00:00Z");
  assert.deepEqual(publicationData(true, true, now), { status: "PUBLISHED", publishedAt: now });
  assert.deepEqual(publicationData(false, true, now), { status: "DRAFT", publishedAt: null });
});
