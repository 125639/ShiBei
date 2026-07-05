"use client";

import Link from "next/link";
import { useState } from "react";
import { I18nText } from "./I18nText";
import { SubmitButton } from "./SubmitButton";

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
  // 翻页/筛选后列表会变化，丢弃已不在当前页的选择，避免计数与提交内容错乱。
  const validIds = new Set(posts.map((post) => post.id));
  const activeSelectedIds = selectedIds.filter((id) => validIds.has(id));
  const allSelected = posts.length > 0 && activeSelectedIds.length === posts.length;

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? posts.map((post) => post.id) : []);
  }

  function togglePost(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  }

  const ACTION_LABELS: Record<string, string> = {
    delete: "删除",
    publish: "发布",
    draft: "改为草稿",
    archive: "归档"
  };

  return (
    <form
      className="form-stack"
      action="/api/admin/posts/bulk"
      method="post"
      onSubmit={(event) => {
        if (!activeSelectedIds.length) {
          event.preventDefault();
          return;
        }
        if (action === "delete" && !confirm(`确认删除选中的 ${activeSelectedIds.length} 篇文章？此操作不可撤销。`)) {
          event.preventDefault();
        }
      }}
    >
      <div className="bulk-toolbar">
        <label>
          <input type="checkbox" checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} /> <I18nText zh="全选" en="Select all" />
        </label>
        <span className="muted" role="status"><I18nText zh={`已选择 ${activeSelectedIds.length} / ${posts.length}`} en={`Selected ${activeSelectedIds.length} / ${posts.length}`} /></span>
        <select name="action" value={action} onChange={(event) => setAction(event.target.value)} aria-label="批量操作类型">
          <option value="delete">批量删除 / Delete</option>
          <option value="publish">批量发布 / Publish</option>
          <option value="draft">改为草稿 / To draft</option>
          <option value="archive">批量归档 / Archive</option>
        </select>
        <SubmitButton
          className={action === "delete" ? "danger-button" : "button secondary"}
          disabled={!activeSelectedIds.length}
          pendingLabel={`正在${ACTION_LABELS[action] || "执行"}…`}
        >
          <I18nText zh="执行" en="Apply" />
        </SubmitButton>
      </div>

      <div className="table-list">
        {posts.length === 0 ? (
          <p className="muted-block"><I18nText zh="没有匹配的文章。试试调整搜索关键词或状态筛选。" en="No matching posts — adjust the search keywords or status filter." /></p>
        ) : posts.map((post) => (
          <div className="table-item selectable-row" key={post.id}>
            <label className="row-checkbox" aria-label={`选择 ${post.title}`}>
              <input
                type="checkbox"
                name="postId"
                value={post.id}
                checked={activeSelectedIds.includes(post.id)}
                onChange={(event) => togglePost(post.id, event.target.checked)}
              />
            </label>
            <div>
              <strong>{post.title}</strong>
              <p className="muted">{post.summary}</p>
              <div className="meta-row">
                <span className="tag">{post.status}</span>
                <span className="tag"><I18nText zh="视频" en="videos" /> {post.videosCount}</span>
                <span className="tag"><I18nText zh="排序" en="order" /> {post.sortOrder}</span>
              </div>
            </div>
            <Link className="button secondary" href={`/admin/posts/${post.id}`}><I18nText zh="编辑" en="Edit" /></Link>
          </div>
        ))}
      </div>
    </form>
  );
}
