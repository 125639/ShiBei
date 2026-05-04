import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatBytes } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Track = {
  id: string;
  title: string;
  artist: string | null;
  filePath: string;
  fileSizeBytes: number | null;
  isEnabled: boolean;
  sortOrder: number;
  createdAt: Date;
};

export default async function MusicAdminPage() {
  await requireAdmin();
  let tracks: Track[] = [];
  try {
    tracks = await (prisma as unknown as {
      music: { findMany: (args: unknown) => Promise<Track[]> };
    }).music.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
  } catch {
    tracks = [];
  }

  return (
    <AdminShell>
      <p className="eyebrow">Music</p>
      <h1>背景音乐</h1>
      <p className="muted-block" style={{ maxWidth: 720 }}>
        上传 MP3 / M4A / OGG / WAV 等格式的背景音乐。前台用户可以在「设置」页中开启与选曲。
        默认上传后即启用；删除会同时清理本地文件。
      </p>

      <form
        className="form-card form-stack"
        action="/api/admin/music"
        method="post"
        encType="multipart/form-data"
        style={{ maxWidth: 560 }}
      >
        <h2>上传新曲目</h2>
        <div className="field">
          <label htmlFor="file">音频文件</label>
          <input id="file" name="file" type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav" required />
          <small className="muted">建议使用 MP3，单文件 ≤ 30 MB。</small>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="title">标题</label>
            <input id="title" name="title" placeholder="留空则用文件名" />
          </div>
          <div className="field">
            <label htmlFor="artist">作者 / 艺术家</label>
            <input id="artist" name="artist" placeholder="可选" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sortOrder">排序（小的在前）</label>
          <input id="sortOrder" name="sortOrder" type="number" defaultValue={tracks.length} />
        </div>
        <button className="button" type="submit">
          上传
        </button>
      </form>

      <section className="admin-panel" style={{ marginTop: 18 }}>
        <h2>当前曲目（{tracks.length}）</h2>
        {tracks.length === 0 ? (
          <p className="muted">暂无音乐。上传后用户即可在前台「设置」中启用。</p>
        ) : (
          <div className="table-list">
            {tracks.map((track) => (
              <div className="table-item" key={track.id}>
                <div>
                  <strong>{track.title}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {track.artist || "未知"} · {formatBytes(track.fileSizeBytes || 0)} · 排序 {track.sortOrder}
                  </div>
                  <audio controls preload="none" src={track.filePath} style={{ marginTop: 8, maxWidth: "100%" }} />
                </div>
                <form action={`/api/admin/music?id=${encodeURIComponent(track.id)}`} method="post">
                  <input type="hidden" name="_method" value="DELETE" />
                  <button
                    className="danger-button"
                    type="submit"
                    formAction={`/api/admin/music/delete?id=${encodeURIComponent(track.id)}`}
                  >
                    删除
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}
