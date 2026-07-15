"use client";

import { useState } from "react";
import { I18nText } from "@/components/I18nText";
import {
  MANUAL_STORAGE_CLEANUP_CONFIRMATION,
  manualStorageCleanupConfirmationMessage
} from "@/lib/storage-cleanup-policy";

export function StorageCleanupControls({ retentionDays }: { retentionDays: number }) {
  const confirmationMessage = manualStorageCleanupConfirmationMessage(retentionDays);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      action="/api/admin/storage/cleanup"
      method="post"
      style={{ marginTop: 16 }}
      aria-describedby="manual-storage-cleanup-warning"
      onSubmit={(event) => {
        // Form-level confirmation also covers Enter-key and requestSubmit()
        // submissions; an onClick-only guard can be bypassed accidentally.
        if (!window.confirm(confirmationMessage)) {
          event.preventDefault();
          return;
        }
        setSubmitting(true);
      }}
    >
      <input
        type="hidden"
        name="confirmation"
        value={MANUAL_STORAGE_CLEANUP_CONFIRMATION}
      />
      <div className="muted-block" id="manual-storage-cleanup-warning">
        <strong><I18nText zh="手动清理是破坏性操作。" en="Manual cleanup is destructive." /></strong>{" "}
        <I18nText
          zh={`它会忽略“自动清理”开关：删除 ${retentionDays} 天前的已完成非批次任务和孤儿素材，归档同样时间范围内的已发布文章（即使空间未超限），并永久删除这些旧归档文章对应的本地视频文件。失败任务与 AI 管理员批次历史会保留；文章正文和视频元数据不会删除。`}
          en={`It ignores the automatic-cleanup switch: standalone completed jobs and orphaned material older than ${retentionDays} days are removed, published posts in that age range are archived even below quota, and their local video files are permanently deleted. Failed jobs and AI admin batch history are retained; post content and video metadata are kept.`}
        />
      </div>
      <button className="danger-button" type="submit" disabled={submitting} aria-busy={submitting}>
        {submitting
          ? <I18nText zh="清理中…" en="Cleaning…" />
          : <I18nText zh="立即按当前规则清理" en="Clean Up Now" />}
      </button>
    </form>
  );
}
