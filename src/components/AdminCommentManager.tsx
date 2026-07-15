"use client";

import { useState } from "react";
import { I18nText } from "./I18nText";

export type AdminCommentView = {
  id: string;
  content: string;
  createdAt: string;
  author: string;
  postTitle: string;
  postSlug: string;
};

export function AdminCommentManager({ initialComments }: { initialComments: AdminCommentView[] }) {
  const [comments, setComments] = useState(initialComments);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function remove(id: string) {
    if (!window.confirm("确认永久删除这条评论吗？此操作无法撤销。")) return;
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/admin/comments/${id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "删除失败");
      setComments((current) => current.filter((comment) => comment.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="admin-panel">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {comments.length === 0 ? (
        <p className="muted"><I18nText zh="还没有评论。" en="No comments yet." /></p>
      ) : (
        <ul className="admin-comment-list">
          {comments.map((comment) => (
            <li className="admin-comment-item" key={comment.id}>
              <div className="admin-comment-head">
                <strong>{comment.author}</strong>
                <span className="muted">{new Date(comment.createdAt).toLocaleString()}</span>
                <a className="text-link" href={`/posts/${comment.postSlug}`} target="_blank" rel="noreferrer">
                  {comment.postTitle}
                </a>
                <button
                  className="text-link"
                  type="button"
                  disabled={busyId === comment.id}
                  onClick={() => void remove(comment.id)}
                >
                  {busyId === comment.id ? <I18nText zh="删除中…" en="Deleting..." /> : <I18nText zh="删除" en="Delete" />}
                </button>
              </div>
              <p className="admin-comment-body">{comment.content}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
