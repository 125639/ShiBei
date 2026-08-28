import assert from "node:assert/strict";
import test from "node:test";
import { artifactRawItemId } from "../src/lib/job-artifact";

test("job artifact ids are stable for queue retries", () => {
  const first = artifactRawItemId("fetch-job-1", "rss:https://example.com/article");
  const retry = artifactRawItemId("fetch-job-1", "rss:https://example.com/article");
  assert.equal(first, retry);
  assert.match(first, /^job_[a-f0-9]{32}$/);
});

test("job artifact slots and explicit reruns stay distinct", () => {
  assert.notEqual(
    artifactRawItemId("fetch-job-1", "keyword:1"),
    artifactRawItemId("fetch-job-1", "keyword:2")
  );
  assert.notEqual(
    artifactRawItemId("fetch-job-1", "keyword:1"),
    artifactRawItemId("fetch-job-2", "keyword:1")
  );
});
