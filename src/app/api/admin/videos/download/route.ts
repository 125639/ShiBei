import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { getVideoDownloadQueue } from "@/lib/queue";
import { hasLocalWorker } from "@/lib/app-mode";
import { rejectCrossOriginMutation } from "@/lib/request-origin";
import { revisionMediaBlockedRedirect } from "@/lib/post-revision";
import { videoTouchesPendingRevision } from "@/lib/video-download";

// 把一条外链/嵌入视频排入后台下载队列（worker 用 yt-dlp 拉回本地）。
// POST 表单字段：videoId、redirect（可选，仅允许 /admin 内路径）。
// 下载完成后 Video 变为 LOCAL 本地文件，文章中的短代码直接以本地播放器渲染。
export async function POST(request: Request) {
  const denied = rejectCrossOriginMutation(request);
  if (denied) return denied;
  await requireAdmin();
  // Next proxy 的 matcher 排除了 api/admin/videos，模式守卫在这里兜底：
  // frontend 没有 Redis/worker，入队只会 500 + 永远不被消费。
  if (!hasLocalWorker()) {
    return NextResponse.json(
      { error: "当前部署形态没有本地 worker，无法下载视频。请在 backend 上执行「下载到本地」，随后通过同步把文件传到本端。" },
      { status: 400 }
    );
  }
  const form = await request.formData();
  const videoId = String(form.get("videoId") || "").trim();
  const redirect = safeRedirectPath(String(form.get("redirect") || ""));
  if (!videoId) return NextResponse.json({ error: "missing videoId" }, { status: 400 });

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, type: true, url: true, localPath: true, downloadStatus: true }
  });
  if (!video) return NextResponse.json({ error: "视频不存在" }, { status: 404 });
  if (video.type === "LOCAL" && video.localPath) {
    return redirectTo(redirect); // 已是本地文件，无需下载
  }
  if (video.downloadStatus === "queued" || video.downloadStatus === "running") {
    return redirectTo(redirect); // 已在队列/下载中，避免重复任务
  }
  if (await videoTouchesPendingRevision(videoId)) {
    return redirectTo(revisionMediaBlockedRedirect(redirect), request);
  }
  if (!/^https?:\/\//i.test(video.url || "")) {
    return NextResponse.json({ error: "该视频没有可下载的 http(s) 地址" }, { status: 400 });
  }

  await prisma.video.update({
    where: { id: videoId },
    data: { downloadStatus: "queued", downloadError: null }
  });

  const queue = getVideoDownloadQueue();
  try {
    await queue.add("video-download", { videoId }, {
      // 同一视频重复点击只保留一个任务；完成/失败的历史任务自动清理。
      jobId: `video-download-${videoId}`,
      removeOnComplete: true,
      removeOnFail: true
    });
  } catch (error) {
    // 入队失败要把状态回滚，否则按钮会永远显示"排队中"。
    await prisma.video.update({
      where: { id: videoId },
      data: { downloadStatus: "failed", downloadError: "任务入队失败，请确认 Redis/worker 正常后重试" }
    }).catch(() => undefined);
    throw error;
  } finally {
    await queue.close().catch(() => undefined);
  }

  return redirectTo(redirect);
}

function safeRedirectPath(value: string) {
  return value.startsWith("/admin/") || value === "/admin" ? value : "/admin/videos";
}
