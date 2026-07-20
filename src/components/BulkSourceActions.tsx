"use client";

import Link from "next/link";
import { useState } from "react";
import { I18nText } from "./I18nText";
import { SubmitButton } from "./SubmitButton";

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
  failStreak?: number;
  moduleIds: string[];
};

type ModuleOption = {
  id: string;
  name: string;
  slug: string;
  color: string;
};

// 与 worker 的自动暂停阈值保持一致（src/worker/index.ts SOURCE_FAIL_PAUSE_THRESHOLD）。
const SOURCE_FAIL_PAUSE_THRESHOLD = 5;

function formatPopularity(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  if (value > 0) return value.toLocaleString("zh-CN");
  return "0";
}

export function BulkSourceActions({
  sources,
  modules,
  label
}: {
  sources: ListSource[];
  modules: ModuleOption[];
  label: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  // 服务端重渲染后列表可能变化（删除/筛选），丢弃已不存在的选择，避免「已选 3 / 2」这类错乱。
  const validIds = new Set(sources.map((s) => s.id));
  const activeSelectedIds = selectedIds.filter((id) => validIds.has(id));
  const allSelected = sources.length > 0 && activeSelectedIds.length === sources.length;
  const formKey = label.replace(/\s/g, "");

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? sources.map((s) => s.id) : []);
  }

  function toggleSource(id: string, checked: boolean) {
    setSelectedIds((prev) => checked ? [...prev, id] : prev.filter((i) => i !== id));
  }

  function isAutoPaused(source: ListSource) {
    return source.status === "PAUSED" && (source.failStreak || 0) >= SOURCE_FAIL_PAUSE_THRESHOLD;
  }

  function healthLabel(source: ListSource) {
    const failed = source.failed7d || 0;
    const success = source.success7d || 0;
    // 连续失败自动暂停优先级最高。
    if (isAutoPaused(source)) return { zh: "连续失败，已自动暂停", en: "Auto-paused (failing)" };
    if (!source.lastJobStatus) return { zh: "未验证", en: "Not verified" };
    if (source.lastJobStatus === "FAILED") return { zh: "最近失败", en: "Recent failure" };
    if (failed >= 3 && success === 0) return { zh: "需检查", en: "Needs check" };
    if (success > 0) return { zh: "正常", en: "Normal" };
    return { zh: source.lastJobStatus, en: source.lastJobStatus };
  }

  function healthClass(source: ListSource) {
    const label = healthLabel(source);
    if (label.zh === "正常") return "source-health source-health-ok";
    if (label.zh === "连续失败，已自动暂停" || label.zh === "最近失败" || label.zh === "需检查") return "source-health source-health-bad";
    return "source-health";
  }

  return (
    <section className="admin-panel" style={{ marginTop: 18 }}>
      <h2><I18nText zh={label} en={label === "信息源" ? "Information Sources" : "Video Sources"} /></h2>

      <div className="bulk-toolbar">
        <label>
          <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} /> <I18nText zh="全选" en="Select All" />
        </label>
        <span className="muted"><I18nText zh={`已选择 ${activeSelectedIds.length} / ${sources.length}`} en={`Selected ${activeSelectedIds.length} / ${sources.length}`} /></span>
        <div style={{ display: "flex", gap: 8 }}>
          <form id={`bulk-estimate-${formKey}`} action="/api/admin/sources/estimate" method="post" style={{ display: "inline" }}>
            {activeSelectedIds.map((id) => (
              <input key={id} type="hidden" name="sourceId" value={id} />
            ))}
            <SubmitButton
              className="button secondary"
              disabled={!activeSelectedIds.length}
              style={{ fontSize: 13, padding: "6px 10px" }}
              pendingLabel={<I18nText zh="估算中…" en="Estimating…" />}
            >
              <I18nText zh="批量估算知名度" en="Batch Estimate Popularity" />
            </SubmitButton>
          </form>
          <form
            action="/api/admin/sources/delete"
            method="post"
            style={{ display: "inline" }}
            onSubmit={(e) => {
              if (!activeSelectedIds.length || !confirm(`确认删除选中的 ${activeSelectedIds.length} 个来源？此操作不可撤销。`)) {
                e.preventDefault();
              }
            }}
          >
            {activeSelectedIds.map((id) => (
              <input key={id} type="hidden" name="sourceId" value={id} />
            ))}
            <button className="danger-button" type="submit" disabled={!activeSelectedIds.length} style={{ fontSize: 13, padding: "6px 10px" }}>
              <I18nText zh="批量删除" en="Batch Delete" />
            </button>
          </form>
        </div>
      </div>

      <div className="table-list" style={{ marginTop: 14 }}>
        {sources.map((source) => {
          const health = healthLabel(source);
          return (
            <div className="table-item selectable-row" key={source.id}>
              <label className="row-checkbox" aria-label={`选择 ${source.name}`}>
                <input
                  type="checkbox"
                  checked={activeSelectedIds.includes(source.id)}
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
                  {source.isDefault ? <span className="tag"><I18nText zh="默认" en="Default" /></span> : null}
                  <span
                    className={healthClass(source)}
                    title={source.lastJobAt ? `最近任务: ${new Date(source.lastJobAt).toLocaleString("zh-CN")}` : undefined}
                  >
                    <I18nText zh={health.zh} en={health.en} />
                  </span>
                  {(source.failStreak || 0) > 0 && !isAutoPaused(source) ? (
                    <span className="source-health source-health-bad">
                      <I18nText zh={`连续失败 ${source.failStreak} 次`} en={`${source.failStreak} consecutive failures`} />
                    </span>
                  ) : null}
                  <span className="tag"><I18nText zh={`7 天成功 ${source.success7d || 0}`} en={`7d success ${source.success7d || 0}`} /></span>
                  <span className="tag"><I18nText zh={`7 天失败 ${source.failed7d || 0}`} en={`7d failed ${source.failed7d || 0}`} /></span>
                  {source.popularity > 0 || source.popularityUpdatedAt ? (
                    <span
                      className="tag"
                      title={source.popularityUpdatedAt ? `上次更新: ${new Date(source.popularityUpdatedAt).toLocaleString("zh-CN")}` : undefined}
                    >
                      <I18nText zh={`知名度 ${formatPopularity(source.popularity)}`} en={`Popularity ${formatPopularity(source.popularity)}`} />
                    </span>
                  ) : (
                    <span className="tag" style={{ opacity: 0.55 }}><I18nText zh="待估算" en="Pending" /></span>
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
                    <input type="hidden" name="fullEdit" value="true" />
                    <div className="field-row">
                      <div className="field">
                        <label>名称 / Name</label>
                        <input name="name" required defaultValue={source.name} autoFocus />
                      </div>
                      <div className="field">
                        <label>URL</label>
                        <input name="url" type="url" required defaultValue={source.url} />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>类型 / Type</label>
                        <select name="type" defaultValue={source.type}>
                          <option value="WEB">WEB</option>
                          <option value="RSS">RSS</option>
                          <option value="VIDEO">VIDEO</option>
                          <option value="EXA">EXA</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>地区 / Region</label>
                        <select name="region" defaultValue={source.region || "UNKNOWN"}>
                          <option value="UNKNOWN">UNKNOWN</option>
                          <option value="DOMESTIC">DOMESTIC</option>
                          <option value="INTERNATIONAL">INTERNATIONAL</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>知名度 / Popularity</label>
                      <input
                        name="popularity"
                        type="number"
                        min="0"
                        defaultValue={source.popularity}
                        style={{ width: 160 }}
                      />
                      </div>
                    </div>
                    {modules.length ? (
                      <fieldset className="field">
                        <legend><I18nText zh="所属模块（可多选）" en="Modules (multiple)" /></legend>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {modules.map((module) => (
                            <label key={module.id} className="tag" style={{ "--tag-accent": module.color } as React.CSSProperties}>
                              <input
                                type="checkbox"
                                name="moduleIds"
                                value={module.id}
                                defaultChecked={source.moduleIds.includes(module.id)}
                              />
                              {module.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ) : null}
                    <label>
                      <input type="checkbox" name="isDefault" value="true" defaultChecked={source.isDefault} />{" "}
                      <I18nText zh="默认来源" en="Default source" />
                    </label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button className="button" type="submit" style={{ padding: "6px 12px", fontSize: 13 }}><I18nText zh="保存全部修改" en="Save all changes" /></button>
                      <button className="button secondary" type="button" onClick={() => setEditId(null)} style={{ padding: "6px 12px", fontSize: 13 }}><I18nText zh="取消" en="Cancel" /></button>
                    </div>
                  </form>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                <Link className="button secondary" href={`/admin/jobs?sourceId=${source.id}`} style={{ fontSize: 13, padding: "6px 10px" }}>
                  <I18nText zh="任务" en="Jobs" />
                </Link>
                <form action="/api/admin/sources/estimate" method="post">
                  <input type="hidden" name="sourceId" value={source.id} />
                  <SubmitButton className="button secondary" style={{ fontSize: 13, padding: "6px 10px" }} pendingLabel={<I18nText zh="估算中…" en="Estimating…" />}><I18nText zh="估算" en="Estimate" /></SubmitButton>
                </form>
                <button className="button secondary" type="button" onClick={() => setEditId(source.id)} style={{ fontSize: 13, padding: "6px 10px" }}><I18nText zh="编辑" en="Edit" /></button>
                {isAutoPaused(source) ? (
                  <form action="/api/admin/sources/reactivate" method="post" style={{ display: "inline" }}>
                    <input type="hidden" name="sourceId" value={source.id} />
                    <SubmitButton className="button" style={{ fontSize: 13, padding: "6px 10px" }} pendingLabel={<I18nText zh="恢复中…" en="Reactivating…" />}><I18nText zh="恢复启用" en="Reactivate" /></SubmitButton>
                  </form>
                ) : null}
                <form action="/api/admin/run" method="post" style={{ display: "inline" }}>
                  <input type="hidden" name="sourceId" value={source.id} />
                  <SubmitButton className="button secondary" style={{ fontSize: 13, padding: "6px 10px" }} pendingLabel={<I18nText zh="创建中…" en="Creating…" />}><I18nText zh="抓取" en="Fetch" /></SubmitButton>
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
                    <I18nText zh="删除" en="Delete" />
                  </button>
                </form>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
