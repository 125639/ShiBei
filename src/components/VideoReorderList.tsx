"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { VideoPlacement } from "@/lib/video-display";

type VideoRow = {
  id: string;
  title: string;
  type: string;
  url: string;
  displayMode: string;
  lastPlacement: string | null;
  fileSizeBytes: number | null;
  postId: string | null;
  postTitle: string | null;
};

type PostOption = {
  id: string;
  title: string;
};

const PLACEMENT_LABEL: Record<VideoPlacement, string> = {
  "after-intro": "导语之后",
  "before-references": "参考来源之前",
  end: "文章末尾"
};

function normalizePlacement(value: string | null): VideoPlacement {
  if (value === "after-intro" || value === "before-references" || value === "end") return value;
  return "before-references";
}

export function VideoReorderList({
  videos: initialVideos,
  posts,
  formatBytes
}: {
  videos: VideoRow[];
  posts: PostOption[];
  formatBytes: Record<string, string>;
}) {
  const [videos, setVideos] = useState<VideoRow[]>(initialVideos);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const groupsByPost = useMemo(() => {
    const groups = new Map<string, VideoRow[]>();
    for (const video of videos) {
      const key = video.postId || "__unattached__";
      const arr = groups.get(key) || [];
      arr.push(video);
      groups.set(key, arr);
    }
    return groups;
  }, [videos]);

  async function persistOrder(postKey: string, orderedIds: string[]) {
    const postId = postKey === "__unattached__" ? null : postKey;
    const items = orderedIds.map((id, idx) => {
      const video = videos.find((v) => v.id === id);
      return {
        id,
        sortOrder: idx,
        placement: normalizePlacement(video?.lastPlacement || null)
      };
    });
    setSavingId(postKey);
    setError(null);
    try {
      const res = await fetch("/api/admin/videos/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, items })
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || `保存失败 (HTTP ${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setSavingId(null);
    }
  }

  function handleDragEnd(postKey: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const group = groupsByPost.get(postKey) || [];
    const oldIndex = group.findIndex((v) => v.id === active.id);
    const newIndex = group.findIndex((v) => v.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newGroup = arrayMove(group, oldIndex, newIndex);
    const newGroupIds = new Set(newGroup.map((v) => v.id));
    const others = videos.filter((v) => !newGroupIds.has(v.id));
    setVideos([...others, ...newGroup]);
    persistOrder(postKey, newGroup.map((v) => v.id));
  }

  function updatePlacement(videoId: string, placement: VideoPlacement) {
    const target = videos.find((v) => v.id === videoId);
    if (!target) return;
    const updated = videos.map((v) =>
      v.id === videoId ? { ...v, lastPlacement: placement } : v
    );
    setVideos(updated);
    if (target.postId) {
      const group = (groupsByPost.get(target.postId) || []).map((v) =>
        v.id === videoId ? { ...v, lastPlacement: placement } : v
      );
      persistOrderWithGroup(target.postId, group);
    }
  }

  function persistOrderWithGroup(postId: string, group: VideoRow[]) {
    const items = group.map((v, idx) => ({
      id: v.id,
      sortOrder: idx,
      placement: normalizePlacement(v.lastPlacement)
    }));
    setSavingId(postId);
    setError(null);
    fetch("/api/admin/videos/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, items })
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "网络错误");
      })
      .finally(() => setSavingId(null));
  }

  const groupEntries = [...groupsByPost.entries()].sort(([a], [b]) => {
    if (a === "__unattached__") return 1;
    if (b === "__unattached__") return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="video-reorder-root" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {error ? (
        <div className="muted-block" style={{ color: "var(--color-danger, #c44)" }}>
          排序保存失败：{error}
        </div>
      ) : null}

      {groupEntries.map(([postKey, group]) => {
        const postTitle = postKey === "__unattached__" ? "未挂载视频" : group[0]?.postTitle || postKey;
        return (
          <div key={postKey} className="form-card" style={{ padding: 20 }}>
            <div className="meta-row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <strong>{postTitle}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  共 {group.length} 个视频
                  {savingId === postKey ? " · 正在保存…" : ""}
                </div>
              </div>
              {postKey !== "__unattached__" ? (
                <a className="text-link" href={`/admin/posts/${postKey}`}>编辑文章</a>
              ) : null}
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => handleDragEnd(postKey, event)}
            >
              <SortableContext items={group.map((v) => v.id)} strategy={verticalListSortingStrategy}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {group.map((video) => (
                    <SortableVideoRow
                      key={video.id}
                      video={video}
                      posts={posts}
                      formattedSize={formatBytes[video.id]}
                      onPlacementChange={updatePlacement}
                      sortable={postKey !== "__unattached__"}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        );
      })}

      <p className="muted" style={{ fontSize: 12 }}>
        提示：拖动行可以调整视频在文章中的相对顺序，三档预设决定每个视频插入文章正文的位置；改完会自动保存。
      </p>
    </div>
  );
}

function SortableVideoRow({
  video,
  posts,
  formattedSize,
  onPlacementChange,
  sortable
}: {
  video: VideoRow;
  posts: PostOption[];
  formattedSize: string | undefined;
  onPlacementChange: (id: string, placement: VideoPlacement) => void;
  sortable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: video.id,
    disabled: !sortable
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10
  };

  const placement = normalizePlacement(video.lastPlacement);
  const displayMode = video.displayMode || "embed";

  return (
    <div ref={setNodeRef} style={style}>
      <div className="meta-row" style={{ alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
          {sortable ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label="拖动排序"
              style={{
                cursor: "grab",
                background: "transparent",
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "2px 8px",
                fontSize: 14,
                lineHeight: 1
              }}
            >
              ⠿
            </button>
          ) : null}
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {video.title}
            </strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {video.type} · {formattedSize ? formattedSize + " · " : ""}
              ID <code>{video.id}</code>
            </div>
          </div>
        </div>
        <code style={{ fontSize: 11, opacity: 0.7 }}>[[video:{video.id}]]</code>
      </div>

      {video.type === "LOCAL" && video.url ? (
        <video controls preload="metadata" src={video.url} style={{ maxWidth: "100%", maxHeight: 220 }} />
      ) : null}

      <div className="meta-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <form action="/api/admin/videos/attach" method="post" className="meta-row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="id" value={video.id} />
          <input type="hidden" name="redirect" value="/admin/videos" />
          <select name="postId" defaultValue={video.postId || ""} style={{ maxWidth: 240 }}>
            <option value="">—— 解除挂载 ——</option>
            {posts.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          <select name="displayMode" defaultValue={displayMode}>
            <option value="embed">嵌入</option>
            <option value="link">链接</option>
          </select>
          <button className="button secondary" type="submit">更新挂载</button>
        </form>

        {video.postId ? (
          <label className="meta-row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className="muted">位置：</span>
            <select
              value={placement}
              onChange={(event) => onPlacementChange(video.id, normalizePlacement(event.target.value))}
            >
              <option value="after-intro">{PLACEMENT_LABEL["after-intro"]}</option>
              <option value="before-references">{PLACEMENT_LABEL["before-references"]}</option>
              <option value="end">{PLACEMENT_LABEL.end}</option>
            </select>
          </label>
        ) : null}

        <form
          action={`/api/admin/videos/delete?id=${encodeURIComponent(video.id)}&redirect=/admin/videos`}
          method="post"
          style={{ marginLeft: "auto" }}
        >
          <button
            type="submit"
            className="text-link"
            style={{ color: "var(--color-danger, #c44)", background: "none", border: 0, padding: 0, cursor: "pointer" }}
          >
            删除视频
          </button>
        </form>
      </div>
    </div>
  );
}
