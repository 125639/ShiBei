"use client";

import Link from "next/link";
import { useState } from "react";

type BulkPost = {
  id: string;
  title: string;
  summary: string;
  status: string;
  videosCount: number;
  sortOrder: number;
};

export function BulkPostActions({ posts }: { posts: BulkPost[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [action, setAction] = useState("delete");
  const allSelected = posts.length > 0 && selectedIds.length === posts.length;

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? posts.map((post) => post.id) : []);
  }

  function togglePost(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  }

  return (
    <form
      className="form-stack"
      action="/api/admin/posts/bulk"
      method="post"
      onSubmit={(event) => {
        if (!selectedIds.length) {
          event.preventDefault();
          return;
        }
        if (action === "delete" && !confirm(`确认删除选中的 ${selectedIds.length} 篇文章？此操作不可撤销。`)) {
          event.preventDefault();
        }
      }}
    >
      <div className="bulk-toolbar">
        <label>
          <input type="checkbox" checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} /> 全选
        </label>
        <span className="muted">已选择 {selectedIds.length} / {posts.length}</span>
        <select name="action" value={action} onChange={(event) => setAction(event.target.value)}>
          <option value="delete">批量删除</option>
          <option value="publish">批量发布</option>
          <option value="draft">改为草稿</option>
          <option value="archive">批量归档</option>
        </select>
        <button className={action === "delete" ? "danger-button" : "button secondary"} type="submit" disabled={!selectedIds.length}>执行</button>
      </div>

      <div className="table-list">
        {posts.map((post) => (
          <div className="table-item selectable-row" key={post.id}>
            <label className="row-checkbox" aria-label={`选择 ${post.title}`}>
              <input
                type="checkbox"
                name="postId"
                value={post.id}
                checked={selectedIds.includes(post.id)}
                onChange={(event) => togglePost(post.id, event.target.checked)}
              />
            </label>
            <div>
              <strong>{post.title}</strong>
              <p className="muted">{post.summary}</p>
              <div className="meta-row">
                <span className="tag">{post.status}</span>
                <span className="tag">视频 {post.videosCount}</span>
                <span className="tag">排序 {post.sortOrder}</span>
              </div>
            </div>
            <Link className="button secondary" href={`/admin/posts/${post.id}`}>编辑</Link>
          </div>
        ))}
      </div>
    </form>
  );
}
