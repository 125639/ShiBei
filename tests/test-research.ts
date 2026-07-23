import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKeywordResearchUrl,
  parseKeywordResearchUrl,
  parseRawItemKeywordUrl
} from "../src/lib/research";

test("keyword research task URLs round-trip independently from raw-item URLs", () => {
  const taskUrl = buildKeywordResearchUrl("research tips", "international", 2, "deep");

  assert.deepEqual(parseKeywordResearchUrl(taskUrl), {
    keyword: "research tips",
    scope: "international",
    count: 2,
    depth: "deep"
  });
  assert.equal(parseRawItemKeywordUrl(taskUrl), null);
});

test("raw-item keywords beginning with research are not mistaken for task URLs", () => {
  assert.deepEqual(parseRawItemKeywordUrl("keyword://research%20tips"), {
    keyword: "research tips"
  });
  assert.deepEqual(parseRawItemKeywordUrl("keyword://research"), {
    keyword: "research"
  });
  assert.equal(parseRawItemKeywordUrl("keyword://research?q=tips"), null);
  assert.equal(parseRawItemKeywordUrl("keyword://%E0%A4%A"), null);
});
