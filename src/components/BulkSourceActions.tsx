"use client";

import Link from "next/link";
import { useState } from "react";

export type ListSource = {
  id: string;
  name: string;
  url: string;
  type: string;
  status: string;
  isDefault: boolean;
  popularity: number;
  popularityUpdatedAt: string | null;
  region?: string;
  lastJobStatus?: string | null;
  lastJobAt?: string | null;
  lastJobError?: string | null;
  success7d?: number;
  failed7d?: number;
};

function formatPopularity(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  if (value > 0) return value.toLocaleString("zh-CN");
  return "0";
}

export function BulkSourceActions({ sources, label }: { sources: ListSource[]; label: string }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const allSelected = sources.length > 0 && selectedIds.length === sources.length;
  const formKey = label.replace(/\s/g, "");

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? sources.map((s) => s.id) : []);
  }

  function toggleSource(id: string, checked: boolean) {
    setSelectedIds((prev) => checked ? [...prev, id] : prev.filter((i) => i !== id));
  }

  function healthLabel(source: ListSource) {
    const failed = source.failed7d || 0;
    const success = source.success7d || 0;
    if (!source.lastJobStatus) return "未验证";
    if (source.lastJobStatus === "FAILED") return "最近失败";
    if (failed >= 3 && success === 0) return "需检查";
    if (success > 0) return "正常";
    return source.lastJobStatus;
  }

  function healthClass(source: ListSource) {
    const label = healthLabel(source);
    if (label === "正常") return "source-health source-health-ok";
    if (label === "最近失败" || label === "需检查") return "source-health source-health-bad";
    return "source-health";
  }

  return (
    <section className="admin-panel" style={{ marginTop: 18 }}>
      <h2>{label}</h2>

      <div className="bulk-toolbar">
        <label>
          <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} /> 全选
        </label>
        <span className="muted">已选择 {selectedIds.length} / {sources.length}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <form id={`bulk-estimate-${formKey}`} action="/api/admin/sources/estimate" method="post" style={{ display: "inline" }}>
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="sourceId" value={id} />
            ))}
            <button className="button secondary" type="submit" disabled={!selectedIds.length} style={{ fontSize: 13, padding: "6px 10px" }}>
              批量估算知名度
            </button>
          </form>
          <form
            action="/api/admin/sources/delete"
            method="post"
            style={{ display: "inline" }}
            onSubmit={(e) => {
              if (!selectedIds.length || !confirm(`确认删除选中的 ${selectedIds.length} 个来源？此操作不可撤销。`)) {
                e.preventDefault();
              }
            }}
          >
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="sourceId" value={id} />
            ))}
            <button className="danger-button" type="submit" disabled={!selectedIds.length} style={{ fontSize: 13, padding: "6px 10px" }}>
              批量删除
            </button>
          </form>
        </div>
      </div>

      <div className="table-list" style={{ marginTop: 14 }}>
        {sources.map((source) => (
          <div className="table-item selectable-row" key={source.id}>
            <label className="row-checkbox" aria-label={`选择 ${source.name}`}>
              <input
                type="checkbox"
                checked={selectedIds.includes(source.id)}
                onChange={(e) => toggleSource(source.id, e.target.checked)}
              />
            </label>
            <div>
              <strong>{source.name}</strong>
              <div className="muted">{source.url}</div>
              <div className="meta-row">
                <span className="tag">{source.type}</span>
                <span className="tag">{source.region || "UNKNOWN"}</span>
                <span className="tag">{source.status}</span>
                {source.isDefault ? <span className="tag">默认</span> : null}
                <span
                  className={healthClass(source)}
                  title={source.lastJobAt ? `最近任务: ${new Date(source.lastJobAt).toLocaleString("zh-CN")}` : undefined}
                >
                  {healthLabel(source)}
                </span>
                <span className="tag">7 天成功 {source.success7d || 0}</span>
                <span className="tag">7 天失败 {source.failed7d || 0}</span>
                {source.popularity > 0 || source.popularityUpdatedAt ? (
                  <span
                    className="tag"
                    title={source.popularityUpdatedAt ? `上次更新: ${new Date(source.popularityUpdatedAt).toLocaleString("zh-CN")}` : undefined}
                  >
                    知名度 {formatPopularity(source.popularity)}
                  </span>
                ) : (
                  <span className="tag" style={{ opacity: 0.55 }}>待估算</span>
                )}
              </div>
              {source.lastJobError ? <p className="job-error">{source.lastJobError.slice(0, 180)}</p> : null}
              {editId === source.id ? (
                <form
                  className="form-stack"
                  action="/api/admin/sources/update"
                  method="post"
                  style={{ marginTop: 8 }}
                >
                  <input type="hidden" name="sourceId" value={source.id} />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      name="popularity"
                      type="number"
                      min="0"
                      defaultValue={source.popularity}
                      style={{ width: 160, padding: "6px 8px", border: "1px solid var(--line)", background: "rgba(255,250,242,0.86)", color: "var(--ink)" }}
                      autoFocus
                    />
                    <button className="button" type="submit" style={{ padding: "6px 12px", fontSize: 13 }}>保存</button>
                    <button className="button secondary" type="button" onClick={() => setEditId(null)} style={{ padding: "6px 12px", fontSize: 13 }}>取消</button>
                  </div>
                </form>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
              <Link className="button secondary" href={`/admin/jobs?sourceId=${source.id}`} style={{ fontSize: 13, padding: "6px 10px" }}>
                任务
              </Link>
              <form action="/api/admin/sources/estimate" method="post">
                <input type="hidden" name="sourceId" value={source.id} />
                <button className="button secondary" type="submit" style={{ fontSize: 13, padding: "6px 10px" }}>估算</button>
              </form>
              <button className="button secondary" type="button" onClick={() => setEditId(source.id)} style={{ fontSize: 13, padding: "6px 10px" }}>编辑</button>
              <form action="/api/admin/run" method="post" style={{ display: "inline" }}>
                <input type="hidden" name="sourceId" value={source.id} />
                <button className="button secondary" type="submit" style={{ fontSize: 13, padding: "6px 10px" }}>抓取</button>
              </form>
              <form action="/api/admin/sources/delete" method="post" style={{ display: "inline" }}>
                <input type="hidden" name="sourceId" value={source.id} />
                <button
                  className="danger-button"
                  type="submit"
                  style={{ fontSize: 13, padding: "6px 10px" }}
                  onClick={(e) => {
                    if (!confirm(`确认删除来源「${source.name}」？此操作不可撤销。`)) e.preventDefault();
                  }}
                >
                  删除
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
