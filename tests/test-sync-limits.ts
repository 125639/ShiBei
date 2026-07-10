import assert from "node:assert/strict";
import { describe, test } from "node:test";
import AdmZip from "adm-zip";
import { parseSyncZip } from "../src/lib/sync/export";
import { SYNC_SCHEMA_VERSION } from "../src/lib/sync/types";
import { MAX_SYNC_POSTS, resolveSyncZipLimits } from "../src/lib/sync/limits";

const MB = 1024 * 1024;

describe("sync zip byte limits", () => {
  test("frontend defaults stay far below the 448MB container", () => {
    const limits = resolveSyncZipLimits({ mode: "frontend", env: {} });
    assert.equal(limits.zipBytes, 128 * MB);
    assert.equal(limits.singleFileBytes, 96 * MB);
  });

  test("full/backend keep the original generous defaults", () => {
    assert.equal(resolveSyncZipLimits({ mode: "full", env: {} }).zipBytes, 512 * MB);
    assert.equal(resolveSyncZipLimits({ mode: "backend", env: {} }).singleFileBytes, 350 * MB);
  });

  test("env overrides win and garbage env values fall back to defaults", () => {
    const limits = resolveSyncZipLimits({
      mode: "frontend",
      env: { SYNC_MAX_ZIP_MB: "64", SYNC_MAX_FILE_MB: "not-a-number" }
    });
    assert.equal(limits.zipBytes, 64 * MB);
    assert.equal(limits.singleFileBytes, 96 * MB);
  });
});

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

