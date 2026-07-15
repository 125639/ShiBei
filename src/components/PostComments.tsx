"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { I18nText } from "./I18nText";

type CommentView = {
  id: string;
  content: string;
  createdAt: string;
  author: string;
  mine: boolean;
};

type CommentsPayload = {
  enabled: boolean;
  member: { id: string; name: string } | null;
  comments: CommentView[];
};

/**
 * 文章评论区。仅在站点开启评论时由服务端渲染挂载;
 * 数据与会员态走客户端拉取,发表/删除即时更新。
 */
export function PostComments({ postId }: { postId: string }) {
  const [data, setData] = useState<CommentsPayload | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/public/posts/${postId}/comments`);
      if (!response.ok) return;
      setData((await response.json()) as CommentsPayload);
    } catch {
      // 评论加载失败不影响正文阅读
    }
  }, [postId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/public/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "发表失败");
      setContent("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/public/comments/${id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "删除失败");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data || !data.enabled) return null;

  return (
    <section className="post-comments" aria-label="评论区 / Comments">
      <h2>
        <I18nText zh={`评论（${data.comments.length}）`} en={`Comments (${data.comments.length})`} />
      </h2>

      {data.comments.length === 0 ? (
        <p className="muted"><I18nText zh="还没有评论，来说两句。" en="No comments yet — be the first." /></p>
      ) : (
        <ul className="comment-list">
          {data.comments.map((comment) => (
            <li className="comment-item" key={comment.id}>
              <div className="comment-head">
                <strong>{comment.author}</strong>
                <span className="muted">{new Date(comment.createdAt).toLocaleString()}</span>
                {comment.mine ? (
                  <button
                    className="text-link comment-delete"
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(comment.id)}
                  >
                    <I18nText zh="删除" en="Delete" />
                  </button>
                ) : null}
              </div>
              <p className="comment-body">{comment.content}</p>
            </li>
          ))}
        </ul>
      )}

      {data.member ? (
        <form className="comment-form" onSubmit={submit}>
          <label htmlFor="comment-input" className="muted">
            <I18nText zh={`以 ${data.member.name} 的身份评论`} en={`Commenting as ${data.member.name}`} />
          </label>
          <textarea
            id="comment-input"
            rows={4}
            maxLength={2000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="友善交流，理性讨论 / Keep it kind and constructive"
          />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button" type="submit" disabled={busy || !content.trim()}>
            {busy ? <I18nText zh="提交中…" en="Posting..." /> : <I18nText zh="发表评论" en="Post comment" />}
          </button>
        </form>
      ) : (
        <p className="muted comment-login-hint">
          <I18nText zh="评论需要登录。" en="Sign in to comment." />{" "}
          <Link className="text-link" href="/account">
            <I18nText zh="用邀请码注册 / 登录 →" en="Register with an invite code / sign in →" />
          </Link>
          {error ? <span className="form-error"> {error}</span> : null}
        </p>
      )}
    </section>
  );
}
