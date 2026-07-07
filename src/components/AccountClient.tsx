"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Member = { id: string; email: string; displayName: string | null };

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
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
      const endpoint = tab === "login" ? "/api/member/login" : "/api/member/register";
      const body =
        tab === "login" ? { email, password } : { email, password, displayName: displayName.trim() || undefined };
      const data = await requestJson<{ member: Member; claimedWorks: number }>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      setPassword("");
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
            {member.displayName ? `${member.displayName}（${member.email}）` : member.email}
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
          <h2>{tab === "login" ? "登录" : "邮箱注册"}</h2>
          <p className="muted-block">
            注册后作品长期保存、跨设备访问，发布后也可以随时删除；当前浏览器里的匿名作品会自动归入账号。
          </p>
          <div className="row-actions" role="tablist" aria-label="登录或注册">
            <button
              className={`button ${tab === "login" ? "" : "secondary"}`}
              type="button"
              role="tab"
              aria-selected={tab === "login"}
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
              role="tab"
              aria-selected={tab === "register"}
              onClick={() => {
                setTab("register");
                setError("");
              }}
            >
              注册
            </button>
          </div>
          <form className="form-stack" onSubmit={submitAuth}>
            <div className="field">
              <label htmlFor="member-email">邮箱</label>
              <input
                id="member-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            {tab === "register" ? (
              <div className="field">
                <label htmlFor="member-name">昵称（可选，公开发布时署名用）</label>
                <input
                  id="member-name"
                  maxLength={40}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="member-password">密码{tab === "register" ? "（至少 8 位）" : ""}</label>
              <input
                id="member-password"
                type="password"
                required
                minLength={tab === "register" ? 8 : 1}
                autoComplete={tab === "register" ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
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
