"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Member = { id: string; email: string | null; username: string | null; displayName: string | null };

function memberLabel(member: Member) {
  const name = member.displayName || member.username || member.email || "会员";
  const account = member.username || member.email;
  return member.displayName && account ? `${name}（${account}）` : name;
}

type WorkListItem = {
  id: string;
  slug: string | null;
  status: "INTERVIEWING" | "DRAFT" | "SHARED";
  topic: string;
  title: string;
  score: number | null;
  hasHistoricalScore: boolean;
  canDelete: boolean;
  updatedAt: string;
  genre: { name: string; threshold: number };
};

type WorkListPage = {
  works: WorkListItem[];
  nextCursor: string | null;
};

const STATUS_LABELS: Record<WorkListItem["status"], string> = {
  INTERVIEWING: "访谈中",
  DRAFT: "草稿",
  SHARED: "已公开"
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `请求失败（${response.status}）`);
  return data as T;
}

export function AccountClient() {
  const [member, setMember] = useState<Member | null>(null);
  const [works, setWorks] = useState<WorkListItem[]>([]);
  const [worksNextCursor, setWorksNextCursor] = useState<string | null>(null);
  const [worksLoadingMore, setWorksLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<"login" | "register">("login");
  const [account, setAccount] = useState("");
  const [secret, setSecret] = useState("");
  const [username, setUsername] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [upgradePassword, setUpgradePassword] = useState("");
  const [upgradePasswordConfirm, setUpgradePasswordConfirm] = useState("");
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const worksRequestRef = useRef(0);
  const worksPageLoadingRef = useRef(false);

  const refresh = useCallback(async () => {
    const requestId = ++worksRequestRef.current;
    const [me, workData] = await Promise.all([
      requestJson<{ member: Member | null }>("/api/member/me"),
      requestJson<WorkListPage>("/api/public/creation/works")
    ]);
    if (requestId !== worksRequestRef.current) return;
    setMember(me.member);
    setWorks(workData.works);
    setWorksNextCursor(workData.nextCursor);
    setLoaded(true);
  }, []);

  const loadMoreWorks = useCallback(async () => {
    const cursor = worksNextCursor;
    if (!cursor || worksPageLoadingRef.current) return;
    const requestId = worksRequestRef.current;
    worksPageLoadingRef.current = true;
    setWorksLoadingMore(true);
    setError("");
    try {
      const page = await requestJson<WorkListPage>(
        `/api/public/creation/works?cursor=${encodeURIComponent(cursor)}`
      );
      // Authentication may have changed in this or another tab. The server
      // also identity-binds the cursor; this client guard prevents stale pages
      // from being appended after a local login/logout refresh.
      if (requestId !== worksRequestRef.current) return;
      setWorks((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...page.works.filter((item) => !existing.has(item.id))];
      });
      setWorksNextCursor(page.nextCursor);
    } catch (err) {
      if (requestId === worksRequestRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      worksPageLoadingRef.current = false;
      setWorksLoadingMore(false);
    }
  }, [worksNextCursor]);

  useEffect(() => {
    refresh().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(true);
    });
  }, [refresh]);

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const endpoint = tab === "login" ? "/api/member/login" : "/api/member/register-invite";
      if (tab === "register" && registerPassword !== registerPasswordConfirm) {
        throw new Error("两次输入的密码不一致");
      }
      const body = tab === "login"
        ? { account, secret }
        : { username: username.trim(), code: inviteCode, password: registerPassword };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await response.json().catch(() => ({}))) as {
        member?: Member;
        error?: string;
        requiresCredentialUpgrade?: boolean;
      };
      if (response.status === 428 && data.requiresCredentialUpgrade) {
        setSecret("");
        setUpgradeRequired(true);
        setNotice("旧邀请码已完成身份核验；当前仍未登录，请在 10 分钟内设置你自己的强密码。");
        return;
      }
      if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);

      setSecret("");
      setInviteCode("");
      setRegisterPassword("");
      setRegisterPasswordConfirm("");
      setUpgradeRequired(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitUpgrade(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (upgradePassword !== upgradePasswordConfirm) throw new Error("两次输入的密码不一致");
      await requestJson("/api/member/upgrade-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: upgradePassword })
      });
      setUpgradePassword("");
      setUpgradePasswordConfirm("");
      setUpgradeRequired(false);
      setTab("login");
      setNotice("新密码已设置，旧邀请码已失效。请使用用户名和新密码登录。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordChange(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (newPassword !== newPasswordConfirm) throw new Error("两次输入的新密码不一致");
      await requestJson("/api/member/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setChangePasswordOpen(false);
      await refresh();
      setNotice("密码已修改，所有旧登录已失效。请使用新密码重新登录。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await requestJson("/api/member/logout", { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteWork(work: WorkListItem) {
    const label = work.title || work.topic;
    if (!window.confirm(`确定删除「${label}」吗？此操作不可恢复。`)) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/public/creation/works/${work.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: work.updatedAt })
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <section className="form-card" aria-busy="true">
        <p className="muted-block" role="status">加载中…</p>
      </section>
    );
  }

  return (
    <div className="creation-studio">
      {member ? (
        <section className="form-card form-stack">
          <h2>我的账户</h2>
          <p className="muted-block">
            {memberLabel(member)}
            ——你的作品导出与删除权完全归你所有，包括已公开的作品。
          </p>
          {notice ? <p className="muted-block" role="status">{notice}</p> : null}
          {error ? <p className="muted-block creation-error" role="alert">{error}</p> : null}
          <div className="row-actions">
            <Link className="button" href="/create">去创作</Link>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              aria-expanded={changePasswordOpen}
              onClick={() => {
                setChangePasswordOpen((value) => !value);
                setError("");
              }}
            >
              修改密码
            </button>
            <button className="button secondary" type="button" disabled={busy} onClick={logout}>退出登录</button>
          </div>
          {changePasswordOpen ? (
            <form className="form-stack" onSubmit={submitPasswordChange}>
              <div className="field">
                <label htmlFor="member-current-password">当前密码</label>
                <input
                  id="member-current-password"
                  type="password"
                  required
                  maxLength={100}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="member-new-password">新密码（至少 12 位，包含三类字符）</label>
                <input
                  id="member-new-password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={100}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="member-new-password-confirm">再次输入新密码</label>
                <input
                  id="member-new-password-confirm"
                  type="password"
                  required
                  minLength={12}
                  maxLength={100}
                  autoComplete="new-password"
                  value={newPasswordConfirm}
                  onChange={(event) => setNewPasswordConfirm(event.target.value)}
                />
              </div>
              <button className="button" type="submit" disabled={busy} aria-busy={busy}>
                {busy ? "修改中…" : "修改密码并退出所有登录"}
              </button>
            </form>
          ) : null}
        </section>
      ) : (
        <section className="form-card form-stack">
          <h2>{upgradeRequired ? "设置你的登录密码" : tab === "login" ? "登录" : "邀请码注册"}</h2>
          <p className="muted-block">
            {upgradeRequired
              ? "旧邀请码只完成了身份核验，没有建立会员登录，也不能读取私密内容。请设置强密码，完成后再用用户名和新密码登录。"
              : tab === "login"
                ? "邮箱或用户名都使用你自己设置的密码登录。历史邀请码账号首次可在密码框输入原邀请码，完成一次性密码升级。"
                : "凭管理员发放的邀请码开户，并设置你自己的强密码。邀请码仅使用一次，注册后不能再用于登录。"}
          </p>
          {notice ? <p className="muted-block" role="status">{notice}</p> : null}
          {!upgradeRequired ? <div className="row-actions" role="group" aria-label="登录或注册">
            <button
              className={`button ${tab === "login" ? "" : "secondary"}`}
              type="button"
              aria-pressed={tab === "login"}
              onClick={() => {
                setTab("login");
                setError("");
                setNotice("");
              }}
            >
              登录
            </button>
            <button
              className={`button ${tab === "register" ? "" : "secondary"}`}
              type="button"
              aria-pressed={tab === "register"}
              onClick={() => {
                setTab("register");
                setError("");
                setNotice("");
              }}
            >
              注册
            </button>
          </div> : null}
          {upgradeRequired ? (
            <form className="form-stack" onSubmit={submitUpgrade}>
              <div className="field">
                <label htmlFor="member-upgrade-password">新密码（至少 12 位，包含三类字符）</label>
                <input
                  id="member-upgrade-password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={100}
                  autoComplete="new-password"
                  value={upgradePassword}
                  onChange={(event) => setUpgradePassword(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="member-upgrade-password-confirm">再次输入新密码</label>
                <input
                  id="member-upgrade-password-confirm"
                  type="password"
                  required
                  minLength={12}
                  maxLength={100}
                  autoComplete="new-password"
                  value={upgradePasswordConfirm}
                  onChange={(event) => setUpgradePasswordConfirm(event.target.value)}
                />
              </div>
              {error ? <p className="muted-block creation-error" role="alert">{error}</p> : null}
              <div className="row-actions">
                <button className="button" type="submit" disabled={busy} aria-busy={busy}>
                  {busy ? "设置中…" : "设置新密码"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setUpgradeRequired(false);
                    setError("");
                    setNotice("");
                  }}
                >
                  返回登录
                </button>
              </div>
            </form>
          ) : <form className="form-stack" onSubmit={submitAuth}>
            {tab === "login" ? (
              <>
                <div className="field">
                  <label htmlFor="member-account">账号（邮箱或用户名）</label>
                  <input
                    id="member-account"
                    required
                    autoComplete="username"
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="member-secret">密码</label>
                  <input
                    id="member-secret"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="member-username">用户名（2-24 个字符）</label>
                  <input
                    id="member-username"
                    required
                    minLength={2}
                    maxLength={24}
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="member-invite">邀请码</label>
                  <input
                    id="member-invite"
                    required
                    autoComplete="off"
                    placeholder="SB-XXXX-XXXX"
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="member-register-password">设置密码（至少 12 位，包含三类字符）</label>
                  <input
                    id="member-register-password"
                    type="password"
                    required
                    minLength={12}
                    maxLength={100}
                    autoComplete="new-password"
                    value={registerPassword}
                    onChange={(event) => setRegisterPassword(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="member-register-password-confirm">再次输入密码</label>
                  <input
                    id="member-register-password-confirm"
                    type="password"
                    required
                    minLength={12}
                    maxLength={100}
                    autoComplete="new-password"
                    value={registerPasswordConfirm}
                    onChange={(event) => setRegisterPasswordConfirm(event.target.value)}
                  />
                </div>
              </>
            )}
            {error ? <p className="muted-block creation-error" role="alert">{error}</p> : null}
            <button className="button" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? "提交中…" : tab === "login" ? "登录" : "注册并登录"}
            </button>
          </form>}
        </section>
      )}

      {works.length > 0 ? (
        <section className="form-card form-stack">
          <h2>{member ? "我的作品" : "本浏览器中的匿名作品"}</h2>
          {!member ? (
            <p className="muted-block">这些作品只跟随本浏览器的匿名 Cookie，不会自动转入任何账号。登录期间会暂时隐藏，退出登录后仍可继续访问；清除浏览器数据则会失去访问权限。</p>
          ) : null}
          <ul className="creation-work-list">
            {works.map((work) => {
              return (
                <li key={work.id}>
                  <div className="creation-work-item creation-work-static">
                    <span className={`tag creation-status-${work.status.toLowerCase()}`}>{STATUS_LABELS[work.status]}</span>
                    <span className="creation-work-title">{work.title || work.topic}</span>
                    <span className="muted">
                      {work.genre.name}
                      {work.score !== null
                        ? ` ｜ ${work.score} 分`
                        : work.hasHistoricalScore
                          ? " ｜ 历史评分已失效"
                          : ""}
                    </span>
                  </div>
                  <span className="row-actions">
                    {work.status === "SHARED" && work.slug ? (
                      <Link className="text-link" href={`/community/${work.slug}`}>查看</Link>
                    ) : (
                      <Link className="text-link" href={`/create?work=${encodeURIComponent(work.id)}`}>继续</Link>
                    )}
                    <a className="text-link" href={`/api/public/creation/works/${work.id}/export`} download>导出</a>
                    {!work.canDelete ? (
                      <span className="muted" title="匿名作品一旦曾发布，管理员下架也不会恢复删除权">不可删除</span>
                    ) : (
                      <button className="text-link creation-link-button" type="button" disabled={busy} onClick={() => deleteWork(work)}>
                        删除
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {worksNextCursor ? (
            <button
              className="button secondary"
              type="button"
              data-testid="account-load-more-works"
              disabled={busy || worksLoadingMore}
              aria-busy={worksLoadingMore}
              onClick={() => void loadMoreWorks()}
            >
              {worksLoadingMore ? "正在加载更多作品…" : "加载更多作品"}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
