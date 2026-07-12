"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
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
import { I18nText } from "@/components/I18nText";
import type { VideoPlacement } from "@/lib/video-display";

type VideoRow = {
  id: string;
  title: string;
  type: string;
  url: string;
  displayMode: string;
  lastPlacement: string | null;
  fileSizeBytes: number | null;
  localPath: string | null;
  downloadStatus: string | null;
  downloadError: string | null;
  postId: string | null;
  postTitle: string | null;
};

type PostOption = {
  id: string;
  title: string;
};

const PLACEMENT_LABEL: Record<VideoPlacement, string> = {
  "after-intro": "导语之后 / After intro",
  "before-references": "参考来源之前 / Before references",
  end: "文章末尾 / End"
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
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 连续拖拽/改位置时的并发保护：只认最后一次请求的结果，旧响应不回写 UI。
  const saveSeqRef = useRef(0);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
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
    await submitReorder(postKey, postId, items);
  }

  /** 发送重排请求；用递增序号丢弃过期响应，避免连续拖拽时旧结果覆盖新状态。 */
  async function submitReorder(
    uiKey: string,
    postId: string | null,
    items: Array<{ id: string; sortOrder: number; placement: VideoPlacement }>
  ) {
    const seq = ++saveSeqRef.current;
    setSavingId(uiKey);
    setSavedId(null);
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
      if (seq !== saveSeqRef.current) return;
      // 短暂显示「已保存」，让拖拽结果有明确回执。
      setSavedId(uiKey);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedId(null), 2000);
    } catch (err) {
      if (seq !== saveSeqRef.current) return;
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      if (seq === saveSeqRef.current) setSavingId(null);
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
    void submitReorder(postId, postId, items);
  }

  function moveBy(postKey: string, videoId: string, delta: -1 | 1) {
    const group = groupsByPost.get(postKey) || [];
    if (group.length <= 1) return;
    const currentIndex = group.findIndex((v) => v.id === videoId);
    if (currentIndex < 0) return;
    const targetIndex = currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= group.length) return;
    const newGroup = arrayMove(group, currentIndex, targetIndex);
    const updated = videos.map((v) => {
      const found = newGroup.find((nv) => nv.id === v.id);
      return found || v;
    });
    setVideos(updated);
    persistOrder(postKey, newGroup.map((v) => v.id));
  }

  const groupEntries = [...groupsByPost.entries()].sort(([a], [b]) => {
    if (a === "__unattached__") return 1;
    if (b === "__unattached__") return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="video-reorder-root">
      {error ? (
        <div className="muted-block" role="alert" style={{ color: "var(--color-danger, #c44)" }}>
          <I18nText zh="排序保存失败：" en="Failed to save order: " />{error}
        </div>
      ) : null}

      {groupEntries.map(([postKey, group]) => {
        const postTitle = postKey === "__unattached__" ? <I18nText zh="未挂载视频" en="Unattached videos" /> : group[0]?.postTitle || postKey;
        return (
          <div key={postKey} className="form-card" style={{ padding: 20 }}>
            <div className="meta-row" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <strong>{postTitle}</strong>
                <div className="muted" style={{ fontSize: 12 }} role="status">
                  <I18nText zh={`共 ${group.length} 个视频`} en={`${group.length} videos`} />
                  {savingId === postKey ? <I18nText zh=" · 正在保存…" en=" · Saving…" /> : savedId === postKey ? <I18nText zh=" · ✓ 已保存" en=" · ✓ Saved" /> : ""}
                </div>
              </div>
              {postKey !== "__unattached__" ? (
                <a className="text-link" href={`/admin/posts/${postKey}`}><I18nText zh="编辑文章" en="Edit post" /></a>
              ) : null}
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event) => handleDragEnd(postKey, event)}
            >
              <SortableContext items={group.map((v) => v.id)} strategy={verticalListSortingStrategy}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {group.map((video, index) => (
                    <SortableVideoRow
                      key={video.id}
                      video={video}
                      posts={posts}
                      formattedSize={formatBytes[video.id]}
                      onPlacementChange={updatePlacement}
                      onMoveUp={index > 0 ? () => moveBy(postKey, video.id, -1) : null}
                      onMoveDown={index < group.length - 1 ? () => moveBy(postKey, video.id, 1) : null}
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
        <I18nText
          zh="提示：拖动行可以调整视频在文章中的相对顺序，三档预设决定每个视频插入文章正文的位置；改完会自动保存。"
          en="Tip: drag rows to reorder videos within a post; the three placement presets decide where each one is inserted. Changes save automatically."
        />
      </p>
    </div>
  );
}

function SortableVideoRow({
  video,
  posts,
  formattedSize,
  onPlacementChange,
  onMoveUp,
  onMoveDown,
  sortable
}: {
  video: VideoRow;
  posts: PostOption[];
  formattedSize: string | undefined;
  onPlacementChange: (id: string, placement: VideoPlacement) => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
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
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
          {sortable ? (
            <div className="video-reorder-handles" role="group" aria-label="顺序控制">
              <button
                type="button"
                {...attributes}
                {...listeners}
                aria-label="拖动排序"
                className="video-reorder-handle"
              >
                ⠿
              </button>
              <button
                type="button"
                aria-label="上移"
                className="video-reorder-arrow"
                disabled={!onMoveUp}
                onClick={() => onMoveUp?.()}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="下移"
                className="video-reorder-arrow"
                disabled={!onMoveDown}
                onClick={() => onMoveDown?.()}
              >
                ↓
              </button>
            </div>
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
            <option value="">—— 解除挂载 / Detach ——</option>
            {posts.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          <select name="displayMode" defaultValue={displayMode}>
            <option value="embed">嵌入 / Embed</option>
            <option value="link">链接 / Link</option>
          </select>
          <button className="button secondary" type="submit"><I18nText zh="更新挂载" en="Update" /></button>
        </form>

        <DownloadControl video={video} />

        {video.postId ? (
          <label className="meta-row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
            <span className="muted"><I18nText zh="位置：" en="Placement: " /></span>
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
            onClick={(event) => {
              if (!window.confirm(`确认删除视频「${video.title}」？本地文件会一并清理，此操作不可撤销。`)) {
                event.preventDefault();
              }
            }}
          >
            <I18nText zh="删除视频" en="Delete" />
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * 「下载到本地」控件：外链/嵌入视频排队交给 worker 用 yt-dlp 拉回本地。
 * 下载完成后视频转为 LOCAL、文章内短代码直接以本地播放器渲染，不再依赖外站。
 * 状态存在 Video.downloadStatus 上；页面是 force-dynamic 的，刷新即可看到进展。
 */
function DownloadControl({ video }: { video: VideoRow }) {
  if (video.type === "LOCAL" && (video.localPath || video.url)) {
    return (
      <span className="tag" title={video.localPath || video.url}>
        ✓ <I18nText zh="已下载到本地" en="Downloaded locally" />
      </span>
    );
  }
  if (video.downloadStatus === "queued" || video.downloadStatus === "running") {
    return (
      <span className="muted" style={{ fontSize: 13 }} role="status">
        {video.downloadStatus === "queued"
          ? <I18nText zh="⏳ 已加入下载队列（刷新页面查看进度）" en="⏳ Queued for download (refresh to see progress)" />
          : <I18nText zh="⬇ 正在后台下载（刷新页面查看进度）" en="⬇ Downloading in background (refresh to see progress)" />}
      </span>
    );
  }
  return (
    <form action="/api/admin/videos/download" method="post" className="meta-row" style={{ gap: 8, alignItems: "center" }}>
      <input type="hidden" name="videoId" value={video.id} />
      <input type="hidden" name="redirect" value="/admin/videos" />
      <button className="button secondary" type="submit">
        {video.downloadStatus === "failed" ? <I18nText zh="重试下载" en="Retry download" /> : <I18nText zh="下载到本地" en="Download locally" />}
      </button>
      {video.downloadStatus === "failed" && video.downloadError ? (
        <span
          className="muted"
          role="alert"
          title={video.downloadError}
          style={{ fontSize: 12, color: "var(--color-danger, #c44)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          <I18nText zh="上次失败：" en="Last attempt failed: " />{video.downloadError}
        </span>
      ) : null}
    </form>
  );
}
