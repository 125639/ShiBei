"use client";

import { useEffect, useState } from "react";
import { I18nText } from "@/components/I18nTextClient";
import { MetricCard } from "@/components/MetricCard";
import { StorageCleanupControls } from "./StorageCleanupControls";

type Usage = {
  uploadsBytes: string;
  imageBytes: string;
  musicBytes: string;
  videoBytes: string;
  postCount: number;
  rawItemCount: number;
  fetchJobCount: number;
  visitRowCount: number;
  approxDbBytesEstimate: string;
  maxStorageMb: number;
  cleanupAfterDays: number;
};

export function StorageUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/admin/storage/usage", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: Usage = await response.json();
        if (!controller.signal.aborted) {
          setUsage(data);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);
  function refresh() {
    setLoading(true);
    setRevision((value) => value + 1);
  }
  return (
    <div aria-busy={loading}>
      {loading ? (
        <p className="admin-storage-state" role="status">
          <I18nText
            zh="正在统计存储，其他设置可以继续使用…"
            en="Calculating storage. Other settings remain available…"
          />
        </p>
      ) : null}
      {failed ? (
        <div className="admin-storage-state" role="alert">
          <p>
            <I18nText
              zh="暂时无法读取存储用量，请重试。如果登录已过期，请重新登录。"
              en="Storage usage is unavailable. Try again, or sign in again if your session expired."
            />
          </p>
          <button className="button secondary" type="button" disabled={loading} onClick={refresh}>
            <I18nText zh="重试" en="Retry" />
          </button>
        </div>
      ) : null}
      {usage ? (
        <>
          <div className="admin-grid-3" style={{ marginTop: 16 }}>
            <MetricCard
              label={<I18nText zh="上传目录总和" en="Uploads Total" />}
              value={usage.uploadsBytes}
            />
            <MetricCard label={<I18nText zh="图片缓存" en="Image Cache" />} value={usage.imageBytes} />
            <MetricCard label={<I18nText zh="音乐占用" en="Music Usage" />} value={usage.musicBytes} />
            <MetricCard label={<I18nText zh="视频占用" en="Video Usage" />} value={usage.videoBytes} />
            <MetricCard label={<I18nText zh="文章数量" en="Post Count" />} value={String(usage.postCount)} />
            <MetricCard
              label={<I18nText zh="原始素材" en="Raw Items" />}
              value={String(usage.rawItemCount)}
            />
            <MetricCard
              label={<I18nText zh="任务数量" en="Fetch Jobs" />}
              value={String(usage.fetchJobCount)}
            />
            <MetricCard
              label={<I18nText zh="访问记录行" en="Visit Rows" />}
              value={String(usage.visitRowCount)}
            />
            <MetricCard
              label={<I18nText zh="DB 估算" en="DB Estimate" />}
              value={usage.approxDbBytesEstimate}
            />
            <MetricCard
              label={<I18nText zh="空间上限" en="Space Limit" />}
              value={`${usage.maxStorageMb} MB`}
            />
            <MetricCard
              label={<I18nText zh="保留期限" en="Retention Period" />}
              value={`${usage.cleanupAfterDays} days`}
            />
          </div>
          <button className="button secondary" type="button" disabled={loading} onClick={refresh}>
            <I18nText zh="刷新用量" en="Refresh usage" />
          </button>
          <StorageCleanupControls retentionDays={usage.cleanupAfterDays} />
        </>
      ) : null}
    </div>
  );
}
