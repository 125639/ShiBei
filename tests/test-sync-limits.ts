import assert from "node:assert/strict";
import { describe, test } from "node:test";
import AdmZip from "adm-zip";
import { parseSyncZip } from "../src/lib/sync/export";
import { SYNC_SCHEMA_VERSION } from "../src/lib/sync/types";
import { MAX_SYNC_POSTS } from "../src/lib/sync/limits";

describe("sync import limits", () => {
  test("rejects sync bundles with too many post records", () => {
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({
      schemaVersion: SYNC_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      since: null,
      postCount: MAX_SYNC_POSTS + 1,
      videoCount: 0,
      exporterMode: "backend"
    })));
    zip.addFile("posts.json", Buffer.from(JSON.stringify(new Array(MAX_SYNC_POSTS + 1).fill({}))));
    zip.addFile("videos.json", Buffer.from("[]"));

    assert.throws(() => parseSyncZip(zip.toBuffer()), /posts 数量超过上限/);
  });
});

