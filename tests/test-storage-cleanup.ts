import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "node:test";
import { StorageCleanupControls } from "../src/components/admin/StorageCleanupControls";
import {
  MANUAL_STORAGE_CLEANUP_CONFIRMATION,
  completedStandaloneJobRetentionWhere,
  isManualStorageCleanupConfirmed,
  manualStorageCleanupConfirmationMessage,
  shouldArchiveOldPosts,
  shouldRunStorageCleanup
} from "../src/lib/storage-cleanup-policy";
import {
  runStorageCleanup,
  type StorageCleanupDatabase
} from "../src/lib/storage";

type RecordedCall = { operation: string; args: unknown };

function cleanupDatabase(input: {
  enabled: boolean;
  calls: RecordedCall[];
  videos?: Array<{ id: string; localPath: string | null; postId: string | null; url: string; sourcePageUrl: string | null }>;
}): StorageCleanupDatabase {
  const record = (operation: string, args: unknown, count = 0) => {
    input.calls.push({ operation, args });
    return Promise.resolve({ count });
  };

  return {
    siteSettings: {
      findUnique: async () => ({
        cleanupAfterDays: 30,
        cleanupCustomEnabled: input.enabled,
        maxStorageMb: 2048
      })
    },
    fetchJob: {
      deleteMany: (args) => record("fetchJob.deleteMany", args, 2)
    },
    rawItem: {
      deleteMany: (args) => record("rawItem.deleteMany", args, 3)
    },
    post: {
      updateMany: (args) => record("post.updateMany", args, 4)
    },
    video: {
      findMany: async (args) => {
        input.calls.push({ operation: "video.findMany", args });
        return input.videos ?? [];
      },
      update: async (args) => {
        input.calls.push({ operation: "video.update", args });
        return {};
      }
    }
  };
}

describe("storage cleanup product policy", () => {
  test("background cleanup is an opt-in while explicit manual cleanup bypasses the switch", () => {
    assert.equal(shouldRunStorageCleanup({ trigger: "scheduled", cleanupCustomEnabled: false }), false);
    assert.equal(shouldRunStorageCleanup({ trigger: "scheduled", cleanupCustomEnabled: true }), true);
    assert.equal(shouldRunStorageCleanup({ trigger: "manual", cleanupCustomEnabled: false }), true);
    assert.equal(shouldArchiveOldPosts({ trigger: "scheduled", overQuota: false }), false);
    assert.equal(shouldArchiveOldPosts({ trigger: "scheduled", overQuota: true }), true);
    assert.equal(shouldArchiveOldPosts({ trigger: "manual", overQuota: false }), true);
  });

  test("retention only targets old standalone COMPLETED jobs", () => {
    const cutoff = new Date("2026-06-14T12:00:00.000Z");
    assert.deepEqual(completedStandaloneJobRetentionWhere(cutoff), {
      status: "COMPLETED",
      completedAt: { lt: cutoff },
      adminAiBatchId: null
    });
  });

  test("scheduled cleanup performs no mutation and no filesystem scan when disabled", async () => {
    const calls: RecordedCall[] = [];
    const result = await runStorageCleanup(
      { trigger: "scheduled" },
      {
        database: cleanupDatabase({ enabled: false, calls }),
        dirSize: async () => {
          throw new Error("disabled cleanup must not inspect or mutate storage");
        }
      }
    );

    assert.deepEqual(result, {
      cleaned: false,
      reason: "automatic-cleanup-disabled",
      fetchJobsDeleted: 0,
      rawItemsDeleted: 0,
      archivedPosts: 0,
      videoFilesDeleted: 0,
      bytesFreed: 0
    });
    assert.deepEqual(calls, []);
  });

  test("scheduled retention preserves batches and does not archive below quota", async () => {
    const calls: RecordedCall[] = [];
    const now = Date.parse("2026-07-14T12:00:00.000Z");
    const result = await runStorageCleanup(
      { trigger: "scheduled", daysOverride: 30 },
      {
        database: cleanupDatabase({ enabled: true, calls }),
        dirSize: async () => 0,
        now: () => now
      }
    );

    assert.equal(result.reason, "scheduled-retention");
    assert.equal(calls.some((call) => call.operation === "post.updateMany"), false);
    assert.equal(calls.some((call) => call.operation === "video.findMany"), false);
    const jobDelete = calls.find((call) => call.operation === "fetchJob.deleteMany");
    assert.deepEqual(jobDelete?.args, {
      where: {
        status: "COMPLETED",
        completedAt: { lt: new Date("2026-06-14T12:00:00.000Z") },
        adminAiBatchId: null
      }
    });
  });

  test("enabled scheduled cleanup archives and reclaims old media only after quota is exceeded", async () => {
    const calls: RecordedCall[] = [];
    const result = await runStorageCleanup(
      { trigger: "scheduled", daysOverride: 30 },
      {
        database: cleanupDatabase({ enabled: true, calls }),
        dirSize: async () => 2048 * 1024 * 1024 + 1,
        now: () => Date.parse("2026-07-14T12:00:00.000Z")
      }
    );

    assert.equal(result.reason, "over-quota");
    assert.equal(calls.some((call) => call.operation === "post.updateMany"), true);
    assert.equal(calls.some((call) => call.operation === "video.findMany"), true);
  });

  test("confirmed manual cleanup archives below quota and clears only old archived local video files", async () => {
    const calls: RecordedCall[] = [];
    const unlinked: string[] = [];
    const result = await runStorageCleanup(
      { trigger: "manual", daysOverride: 30 },
      {
        database: cleanupDatabase({
          enabled: false,
          calls,
          videos: [{
            id: "video-1",
            localPath: "/uploads/video/old.mp4",
            postId: "post-1",
            url: "/uploads/video/old.mp4",
            sourcePageUrl: "https://example.com/watch/1"
          }]
        }),
        dirSize: async () => 0,
        resolveLocalPath: (value) => value ? `/safe${value}` : null,
        unlinkFile: async (file) => { unlinked.push(file); },
        now: () => Date.parse("2026-07-14T12:00:00.000Z")
      }
    );

    assert.equal(result.reason, "manual-forced");
    assert.equal(result.archivedPosts, 4);
    assert.equal(result.videoFilesDeleted, 1);
    assert.deepEqual(unlinked, ["/safe/uploads/video/old.mp4"]);
    assert.equal(calls.some((call) => call.operation === "post.updateMany"), true);
    const videoLookup = calls.find((call) => call.operation === "video.findMany");
    assert.deepEqual(videoLookup?.args, {
      where: {
        localPath: { not: null },
        OR: [
          {
            post: {
              status: "ARCHIVED",
              publishedAt: { lt: new Date("2026-06-14T12:00:00.000Z") }
            }
          },
          { postId: null, updatedAt: { lt: new Date("2026-06-14T12:00:00.000Z") } }
        ]
      },
      select: { id: true, localPath: true, postId: true, url: true, sourcePageUrl: true }
    });
    const videoUpdate = calls.find((call) => call.operation === "video.update");
    // 文件删除后必须降级为指向来源页的 LINK：留着 type=LOCAL + /uploads/… 的
    // url 会在重新发布或同步到前端时渲染 404 播放器。
    assert.deepEqual(videoUpdate?.args, {
      where: { id: "video-1" },
      data: { localPath: null, fileSizeBytes: null, type: "LINK", url: "https://example.com/watch/1" }
    });
  });

  test("database failures are surfaced instead of being reported as a successful cleanup", async () => {
    const calls: RecordedCall[] = [];
    const database = cleanupDatabase({ enabled: true, calls });
    database.fetchJob.deleteMany = async () => {
      throw new Error("database unavailable");
    };

    await assert.rejects(
      runStorageCleanup(
        { trigger: "scheduled", daysOverride: 30 },
        { database, dirSize: async () => 0 }
      ),
      /database unavailable/
    );
  });

  test("an already-missing local video heals the stale database pointer", async () => {
    const calls: RecordedCall[] = [];
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const result = await runStorageCleanup(
      { trigger: "manual", daysOverride: 30 },
      {
        database: cleanupDatabase({
          enabled: false,
          calls,
          videos: [{
            id: "video-missing",
            localPath: "/uploads/video/missing.mp4",
            postId: "post-1",
            url: "/uploads/video/missing.mp4",
            sourcePageUrl: null
          }]
        }),
        dirSize: async () => 0,
        resolveLocalPath: () => "/safe/uploads/video/missing.mp4",
        unlinkFile: async () => { throw missing; }
      }
    );

    assert.equal(result.videoFilesDeleted, 0);
    // 无来源页可回退时降级为空 url 的 LINK；渲染层对空 url 有「资源不可用」文案。
    assert.deepEqual(calls.find((call) => call.operation === "video.update")?.args, {
      where: { id: "video-missing" },
      data: { localPath: null, fileSizeBytes: null, type: "LINK", url: "" }
    });
  });
});

describe("manual storage cleanup confirmation and route guards", () => {
  test("confirmation contract is exact and its message states both destructive effects", () => {
    assert.equal(isManualStorageCleanupConfirmed(MANUAL_STORAGE_CLEANUP_CONFIRMATION), true);
    assert.equal(isManualStorageCleanupConfirmed(null), false);
    assert.equal(isManualStorageCleanupConfirmed("yes"), false);
    const message = manualStorageCleanupConfirmationMessage(30);
    assert.match(message, /归档 30 天前/);
    assert.match(message, /永久删除.*本地视频/);
  });

  test("admin UI renders the full warning and server confirmation token", () => {
    const html = renderToStaticMarkup(createElement(StorageCleanupControls, { retentionDays: 30 }));
    assert.match(html, /手动清理是破坏性操作/);
    assert.match(html, /空间未超限/);
    assert.match(html, /AI 管理员批次历史会保留/);
    assert.match(html, new RegExp(`name="confirmation" value="${MANUAL_STORAGE_CLEANUP_CONFIRMATION}"`));
    assert.match(html, /立即按当前规则清理/);
  });

  test("route keeps admin and same-origin checks ahead of the destructive call", () => {
    const source = readFileSync(
      new URL("../src/app/api/admin/storage/cleanup/route.ts", import.meta.url),
      "utf8"
    );
    const adminAt = source.indexOf("await requireAdmin()");
    const originAt = source.indexOf("rejectCrossOriginMutation(request)");
    const confirmationAt = source.indexOf("isManualStorageCleanupConfirmed");
    const cleanupAt = source.indexOf("await runStorageCleanup");
    assert.ok(adminAt >= 0 && originAt > adminAt);
    assert.ok(confirmationAt >= 0 && cleanupAt > confirmationAt);
  });

  test("UI confirmation is attached to form submission, not only button clicks", () => {
    const source = readFileSync(
      new URL("../src/components/admin/StorageCleanupControls.tsx", import.meta.url),
      "utf8"
    );
    assert.match(source, /onSubmit=/);
    assert.match(source, /window\.confirm\(confirmationMessage\)/);
  });
});
