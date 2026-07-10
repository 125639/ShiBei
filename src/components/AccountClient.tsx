"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
  updatedAt: string;
  genre: { name: string; threshold: number };
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
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<"login" | "register">("login");
  const [account, setAccount] = useState("");
  const [secret, setSecret] = useState("");
  const [username, setUsername] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [me, workData] = await Promise.all([
      requestJson<{ member: Member | null }>("/api/member/me"),
      requestJson<{ works: WorkListItem[] }>("/api/public/creation/works")
    ]);
    setMember(me.member);
    setWorks(workData.works);
    setLoaded(true);
  }, []);

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
      const body = tab === "login" ? { account, secret } : { username: username.trim(), code: inviteCode };
      const data = await requestJson<{ member: Member; claimedWorks: number }>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      setSecret("");
      setInviteCode("");
      if (data.claimedWorks > 0) {
        setNotice(`已把当前浏览器中的 ${data.claimedWorks} 篇匿名作品归入你的账号。`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
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
      await requestJson(`/api/public/creation/works/${work.id}`, { method: "DELETE" });
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
            <button className="button secondary" type="button" disabled={busy} onClick={logout}>退出登录</button>
          </div>
        </section>
      ) : (
        <section className="form-card form-stack">
          <h2>{tab === "login" ? "登录" : "邀请码注册"}</h2>
          <p className="muted-block">
            {tab === "login"
              ? "邮箱会员用邮箱 + 密码；邀请码会员用用户名 + 邀请码。"
              : "凭管理员发放的邀请码注册，只需要用户名和邀请码。注册后邀请码就是你的登录凭据，请妥善保存。"}
          </p>
          <div className="row-actions" role="group" aria-label="登录或注册">
            <button
              className={`button ${tab === "login" ? "" : "secondary"}`}
              type="button"
              aria-pressed={tab === "login"}
              onClick={() => {
                setTab("login");
                setError("");
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
              }}
            >
              注册
            </button>
          </div>
          <form className="form-stack" onSubmit={submitAuth}>
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
                  <label htmlFor="member-secret">密码 / 邀请码</label>
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
              </>
            )}
            {error ? <p className="muted-block creation-error" role="alert">{error}</p> : null}
            <button className="button" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? "提交中…" : tab === "login" ? "登录" : "注册并登录"}
            </button>
          </form>
        </section>
      )}

      {works.length > 0 ? (
        <section className="form-card form-stack">
          <h2>{member ? "我的作品" : "本浏览器中的匿名作品"}</h2>
          {!member ? (
            <p className="muted-block">这些作品目前跟随浏览器 Cookie，清除浏览器数据会失去访问权限。注册后自动归入账号。</p>
          ) : null}
          <ul className="creation-work-list">
            {works.map((work) => {
              const anonymousShared = !member && work.status === "SHARED";
              return (
                <li key={work.id}>
                  <div className="creation-work-item creation-work-static">
                    <span className={`tag creation-status-${work.status.toLowerCase()}`}>{STATUS_LABELS[work.status]}</span>
                    <span className="creation-work-title">{work.title || work.topic}</span>
                    <span className="muted">
                      {work.genre.name}
                      {work.score !== null ? ` ｜ ${work.score} 分` : ""}
                    </span>
                  </div>
                  <span className="row-actions">
                    {work.status === "SHARED" && work.slug ? (
                      <Link className="text-link" href={`/community/${work.slug}`}>查看</Link>
                    ) : (
                      <Link className="text-link" href="/create">继续</Link>
                    )}
                    <a className="text-link" href={`/api/public/creation/works/${work.id}/export`}>导出</a>
                    {anonymousShared ? (
                      <span className="muted" title="匿名发布的作品不可删除">不可删除</span>
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
        </section>
      ) : null}
    </div>
  );
}
