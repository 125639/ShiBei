"use client";

import { useState } from "react";
import { I18nText } from "./I18nText";

export type InviteCodeView = {
  id: string;
  code: string | null;
  status: "UNUSED" | "USED" | "REVOKED" | string;
  note: string;
  usedBy: string | null;
  usedAt: string | null;
  createdAt: string;
};

const STATUS_LABELS: Record<string, { zh: string; en: string }> = {
  UNUSED: { zh: "未使用", en: "Unused" },
  USED: { zh: "已使用", en: "Used" },
  REVOKED: { zh: "已作废", en: "Revoked" }
};

export function AdminInviteManager({ initialCodes, page = 1 }: { initialCodes: InviteCodeView[]; page?: number }) {
  const [codes, setCodes] = useState(initialCodes);
  const [count, setCount] = useState(5);
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [freshCodes, setFreshCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const response = await fetch(`/api/admin/invites?page=${page}`);
    if (!response.ok) return;
    const data = (await response.json()) as { codes: InviteCodeView[] };
    setCodes(data.codes);
  }

  async function generate() {
    setCreating(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, note })
      });
      const data = (await response.json().catch(() => ({}))) as { codes?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || "生成失败");
      setFreshCodes(data.codes || []);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, code: string | null) {
    const label = code ? `「${code}」` : "该邀请码";
    if (!window.confirm(`确认永久作废${label}吗？作废后无法恢复，也不能再用于注册。`)) return;
    setError("");
    try {
      const response = await fetch(`/api/admin/invites/${id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "作废失败");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyFresh() {
    try {
      await navigator.clipboard.writeText(freshCodes.join("\n"));
      setCopied(true);
    } catch {
      setError("复制失败，请手动选择复制");
    }
  }

  return (
    <div className="admin-invite-layout">
      <section className="admin-panel">
        <h2><I18nText zh="生成邀请码" en="Generate invite codes" /></h2>
        <p className="muted">
          <I18nText
            zh="生成后请复制并手动发放。用户注册时需填写用户名、邀请码，并自行设置强密码；邀请码仅能开户一次，不是登录密码。"
            en="Copy and distribute codes manually. Registration requires a username, an invite code, and a user-chosen strong password. A code opens an account once and is never a login password."
          />
        </p>
        <div className="field-row">
          <div className="field">
            <label htmlFor="invite-count"><I18nText zh="数量" en="Count" /></label>
            <input
              id="invite-count"
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(event) => setCount(Math.min(Math.max(Number(event.target.value) || 1, 1), 100))}
            />
          </div>
          <div className="field">
            <label htmlFor="invite-note"><I18nText zh="备注（发给谁，可选）" en="Note (optional)" /></label>
            <input
              id="invite-note"
              type="text"
              maxLength={120}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例：读书群第一批"
            />
          </div>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button" type="button" disabled={creating} onClick={generate}>
          {creating ? <I18nText zh="正在生成…" en="Generating..." /> : <I18nText zh="生成" en="Generate" />}
        </button>

        {freshCodes.length ? (
          <div className="invite-fresh" aria-live="polite">
            <div className="invite-fresh-head">
              <strong><I18nText zh={`本次生成 ${freshCodes.length} 个`} en={`${freshCodes.length} new codes`} /></strong>
              <button className="text-link" type="button" onClick={copyFresh}>
                {copied ? <I18nText zh="已复制" en="Copied" /> : <I18nText zh="复制全部" en="Copy all" />}
              </button>
            </div>
            <pre className="invite-fresh-codes">{freshCodes.join("\n")}</pre>
          </div>
        ) : null}
      </section>

      <section className="admin-panel">
        <h2><I18nText zh="邀请码列表" en="All codes" /></h2>
        {codes.length === 0 ? (
          <p className="muted"><I18nText zh="还没有生成过邀请码。" en="No codes yet." /></p>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th><I18nText zh="邀请码" en="Code" /></th>
                  <th><I18nText zh="状态" en="Status" /></th>
                  <th><I18nText zh="备注" en="Note" /></th>
                  <th><I18nText zh="使用者" en="Used by" /></th>
                  <th><I18nText zh="创建时间" en="Created" /></th>
                  <th><I18nText zh="操作" en="Actions" /></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.code ? (
                        <code>{row.code}</code>
                      ) : (
                        <span className="muted"><I18nText zh="已永久遮盖" en="Permanently masked" /></span>
                      )}
                    </td>
                    <td>
                      <span className={`tag invite-status-${row.status.toLowerCase()}`}>
                        <I18nText
                          zh={(STATUS_LABELS[row.status] || { zh: row.status }).zh}
                          en={(STATUS_LABELS[row.status] || { en: row.status }).en || row.status}
                        />
                      </span>
                    </td>
                    <td>{row.note || "—"}</td>
                    <td>{row.usedBy || "—"}</td>
                    <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                    <td>
                      {row.status === "UNUSED" ? (
                        <button className="text-link" type="button" onClick={() => void revoke(row.id, row.code)}>
                          <I18nText zh="作废" en="Revoke" />
                        </button>
                      ) : null}
                    </td>
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
