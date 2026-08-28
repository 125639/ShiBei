"use client";

import Link from "next/link";
import { useState } from "react";
import { I18nText } from "./I18nText";

export type AdminCommunityWorkView = {
  id: string;
  slug: string | null;
  title: string;
  summary: string;
  mode: string;
  score: number | null;
  publishedAt: string | null;
  isAnonymous: boolean;
  author: string;
  genreName: string;
};

export type AdminCommunityAuditView = {
  id: string;
  action: "UNPUBLISH" | "DELETE";
  reason: string;
  targetWorkId: string;
  titleSnapshot: string;
  summarySnapshot: string | null;
  slugSnapshot: string | null;
  wasAnonymous: boolean;
  adminUsername: string;
  createdAt: string;
};

type ModerationPayload = {
  works: AdminCommunityWorkView[];
  audits: AdminCommunityAuditView[];
};

export function AdminCommunityManager({
  initialWorks,
  initialAudits
}: {
  initialWorks: AdminCommunityWorkView[];
  initialAudits: AdminCommunityAuditView[];
}) {
  const [works, setWorks] = useState(initialWorks);
  const [audits, setAudits] = useState(initialAudits);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<"" | "UNPUBLISH" | "DELETE">("");

  async function refresh() {
    const response = await fetch("/api/admin/community-works", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as Partial<ModerationPayload> & { error?: string };
    if (!response.ok) throw new Error(data.error || "刷新治理列表失败");
    setWorks(data.works || []);
    setAudits(data.audits || []);
  }

  async function moderate(work: AdminCommunityWorkView, action: "UNPUBLISH" | "DELETE") {
    const reason = (reasons[work.id] || "").trim();
    if (reason.length < 3) {
      setError("请先填写至少 3 个字符的治理原因。 / Enter a reason of at least 3 characters.");
      return;
    }

    const confirmed = window.confirm(
      action === "DELETE"
        ? `将永久删除公开作品「${work.title}」。若它来自纯手写，私有原稿会保留，但这份原稿的社区交接将被锁定。公开副本无法恢复，确认继续？\nPermanently delete the public copy? A private manual source, if any, will be kept but locked from another community handoff.`
        : `将下架「${work.title}」并退回私有草稿，记录当前版本与原因，同时清除旧评分；原文必须实质修改后才能重新评分或发布。确认继续？\nUnpublish, record this moderated version and reason, and clear its score? The exact version cannot be rescored or republished.`
    );
    if (!confirmed) return;

    setBusy(`${work.id}:${action}`);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/admin/community-works/${work.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; warning?: string };
      if (!response.ok) throw new Error(data.error || "治理操作失败");
      setReasons((current) => ({ ...current, [work.id]: "" }));
      setSuccess(action);
      if (data.warning) setError(data.warning);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="admin-community-layout">
      <section className="admin-panel">
        <div className="row between">
          <h2><I18nText zh={`当前公开作品（${works.length}）`} en={`Currently public (${works.length})`} /></h2>
          <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)))}>
            <I18nText zh="刷新" en="Refresh" />
          </button>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {success ? (
          <p className="muted-block" role="status">
            <I18nText
              zh={success === "DELETE" ? "公开副本已永久删除；私有手写原稿（如有）已保留并锁定再次交接，审计记录已保存。" : "作品已下架为私有草稿；被治理版本已锁定，审计记录已保存。"}
              en={success === "DELETE" ? "The public copy was deleted; any private manual source was kept with its community handoff locked, and the action was audited." : "The work was unpublished; the moderated version was locked and the action was audited."}
            />
          </p>
        ) : null}

        {works.length === 0 ? (
          <div className="empty-state">
            <p><I18nText zh="当前没有公开社区作品。" en="There are no public community works." /></p>
          </div>
        ) : (
          <ul className="admin-community-work-list">
            {works.map((work) => {
              const reason = reasons[work.id] || "";
              return (
                <li className="admin-community-work" key={work.id}>
                  <div className="admin-community-work-head">
                    <div>
                      <h3>{work.slug ? <Link className="text-link" href={`/community/${work.slug}`} target="_blank" rel="noreferrer">{work.title}</Link> : work.title}</h3>
                      <div className="meta-row">
                        <span className="tag">{work.genreName}</span>
                        <span className="tag">{work.isAnonymous ? <I18nText zh="匿名" en="Anonymous" /> : work.author}</span>
                        {work.score !== null ? <span className="tag">{work.score} pts</span> : null}
                        {work.publishedAt ? <span className="muted">{new Date(work.publishedAt).toLocaleString()}</span> : null}
                      </div>
                    </div>
                  </div>
                  {work.summary ? <p className="muted">{work.summary}</p> : null}
                  <div className="field">
                    <label htmlFor={`moderation-reason-${work.id}`}>
                      <I18nText zh="治理原因（必填，将写入审计日志）" en="Moderation reason (required; saved to the audit log)" />
                    </label>
                    <textarea
                      id={`moderation-reason-${work.id}`}
                      rows={2}
                      maxLength={1000}
                      value={reason}
                      disabled={Boolean(busy)}
                      onChange={(event) => setReasons((current) => ({ ...current, [work.id]: event.target.value }))}
                    />
                  </div>
                  <div className="row-actions">
                    <button
                      className="button secondary"
                      type="button"
                      disabled={Boolean(busy) || reason.trim().length < 3}
                      onClick={() => void moderate(work, "UNPUBLISH")}
                    >
                      {busy === `${work.id}:UNPUBLISH` ? <I18nText zh="下架中…" en="Unpublishing..." /> : <I18nText zh="下架为私有草稿" en="Unpublish to private draft" />}
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      disabled={Boolean(busy) || reason.trim().length < 3}
                      onClick={() => void moderate(work, "DELETE")}
                    >
                      {busy === `${work.id}:DELETE` ? <I18nText zh="删除中…" en="Deleting..." /> : <I18nText zh="永久删除违规作品" en="Permanently delete" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="admin-panel">
        <h2><I18nText zh="最近治理审计" en="Recent moderation audit" /></h2>
        {audits.length === 0 ? (
          <div className="empty-state">
            <p><I18nText zh="还没有治理记录。" en="No moderation actions yet." /></p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th><I18nText zh="时间 / 管理员" en="Time / Admin" /></th>
                  <th><I18nText zh="动作" en="Action" /></th>
                  <th><I18nText zh="作品快照" en="Work snapshot" /></th>
                  <th><I18nText zh="原因" en="Reason" /></th>
                </tr>
              </thead>
              <tbody>
                {audits.map((audit) => (
                  <tr key={audit.id}>
                    <td>{new Date(audit.createdAt).toLocaleString()}<br /><span className="muted">{audit.adminUsername}</span></td>
                    <td><span className={audit.action === "DELETE" ? "status-pill tone-danger" : "status-pill tone-warn"}><I18nText zh={audit.action === "DELETE" ? "永久删除" : "下架"} en={audit.action === "DELETE" ? "Deleted" : "Unpublished"} /></span></td>
                    <td>
                      {audit.titleSnapshot}
                      {audit.summarySnapshot ? <><br /><span className="muted">{audit.summarySnapshot}</span></> : null}
                      <br /><code>{audit.targetWorkId}</code>
                      <br /><span className="muted">{audit.slugSnapshot || "—"} · {audit.wasAnonymous ? "anonymous" : "member"}</span>
                    </td>
                    <td className="admin-community-audit-reason">{audit.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
