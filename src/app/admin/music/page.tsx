import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { ConfirmButton } from "@/components/ConfirmButton";
import { SubmitButton } from "@/components/SubmitButton";
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
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Music</p>
          <h1><I18nText zh="背景音乐" en="Background Music" /></h1>
        </div>
      </div>
      <p className="muted-block" style={{ maxWidth: 720 }}>
        <I18nText
          zh="上传 MP3 / M4A / OGG / WAV 等格式的背景音乐。前台用户可以在「设置」页中开启与选曲。默认上传后即启用；删除会同时清理本地文件。"
          en="Upload background music (MP3 / M4A / OGG / WAV). Visitors can enable and pick tracks on the public Settings page. Tracks are enabled on upload; deleting also removes the local file."
        />
      </p>

      <form
        className="form-card form-stack"
        action="/api/admin/music"
        method="post"
        encType="multipart/form-data"
        style={{ maxWidth: 560 }}
      >
        <h2><I18nText zh="上传新曲目" en="Upload Track" /></h2>
        <div className="field">
          <label htmlFor="file"><I18nText zh="音频文件" en="Audio file" /></label>
          <input id="file" name="file" type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav" required />
          <small className="muted"><I18nText zh="建议使用 MP3，单文件 ≤ 30 MB。" en="MP3 recommended, ≤ 30 MB per file." /></small>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="title"><I18nText zh="标题" en="Title" /></label>
            <input id="title" name="title" placeholder="留空则用文件名 / defaults to filename" />
          </div>
          <div className="field">
            <label htmlFor="artist"><I18nText zh="作者 / 艺术家" en="Artist" /></label>
            <input id="artist" name="artist" placeholder="可选 / optional" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sortOrder"><I18nText zh="排序（小的在前）" en="Sort order (asc)" /></label>
          <input id="sortOrder" name="sortOrder" type="number" defaultValue={tracks.length} />
        </div>
        <SubmitButton pendingLabel={<I18nText zh="上传中…" en="Uploading…" />}><I18nText zh="上传" en="Upload" /></SubmitButton>
      </form>

      <section className="admin-panel" style={{ marginTop: 24 }}>
        <h2><I18nText zh={`当前曲目（${tracks.length}）`} en={`Tracks (${tracks.length})`} /></h2>
        {tracks.length === 0 ? (
          <div className="empty-state">
            <p><I18nText zh="暂无音乐。上传后用户即可在前台「设置」中启用。" en="No music yet. Once uploaded, visitors can enable it in Settings." /></p>
          </div>
        ) : (
          <div className="table-list">
            {tracks.map((track) => (
              <div className="table-item" key={track.id}>
                <div>
                  <strong>{track.title}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {track.artist || "—"} · {formatBytes(track.fileSizeBytes || 0)} · <I18nText zh="排序" en="order" /> {track.sortOrder}
                  </div>
                  <audio controls preload="none" src={track.filePath} style={{ marginTop: 8, maxWidth: "100%" }} />
                </div>
                <form action={`/api/admin/music?id=${encodeURIComponent(track.id)}`} method="post">
                  <input type="hidden" name="_method" value="DELETE" />
                  <ConfirmButton
                    message={`确认删除曲目「${track.title}」？本地文件会一并清理，此操作不可撤销。`}
                    formAction={`/api/admin/music/delete?id=${encodeURIComponent(track.id)}`}
                  >
                    <I18nText zh="删除" en="Delete" />
                  </ConfirmButton>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}
