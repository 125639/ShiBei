// 一次性回填：把已有文章里"堆在文末"的视频短代码按章节相关性重新分布，
// 顺带清理 AI 生成的「相关视频」占位小节、指向已删除视频的悬空短代码，
// 以及历史自动挂载流程误收的"URL 含 video 字样的非视频链接"记录。
// 用法：
//   npm run repair:post-videos          # 实际写库
//   npm run repair:post-videos -- --dry-run   # 只报告将发生的变更
// 本地跑需覆盖 DATABASE_URL 指向 docker postgres（见 DEPLOY_NOTES.md）。
import { prisma } from "../src/lib/prisma";
import { isAutoAttachableVideoUrl } from "../src/lib/video-candidates";
import {
  distributeVideoShortcodes,
  removePlaceholderVideoSections,
  removeVideoShortcode,
  VIDEO_SHORTCODE_RE
} from "../src/lib/video-display";

/**
 * 删除历史自动流程收进来的垃圾"视频"：只针对 attribution 带自动流程模板句
 * 的 LINK 记录（人工添加的视频不会带这些句式），且其 URL 按现行准入规则
 * （直链媒体 / 已知视频平台）根本不该入库——典型如产品控制台、频道导航页。
 * 先删行，后面的正文重写会把它们的短代码当悬空引用一并清掉。
 */
async function pruneAutoAttachedJunk(dryRun: boolean): Promise<Set<string>> {
  const autoVideos = await prisma.video.findMany({
    where: {
      type: "LINK",
      OR: [
        { attribution: { contains: "自动流程仅保留链接" } },
        { attribution: { contains: "研究资料自动提取" } }
      ]
    },
    select: { id: true, title: true, url: true }
  });
  const junk = autoVideos.filter((video) => !isAutoAttachableVideoUrl(video.url));
  for (const video of junk) {
    console.log(`${dryRun ? "[dry-run] " : ""}prune junk video: ${video.title} — ${video.url}`);
  }
  if (!dryRun && junk.length) {
    await prisma.video.deleteMany({ where: { id: { in: junk.map((video) => video.id) } } });
  }
  return new Set(junk.map((video) => video.id));
}

function collectShortcodeIds(...texts: Array<string | null | undefined>): Set<string> {
  const ids = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    VIDEO_SHORTCODE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VIDEO_SHORTCODE_RE.exec(text)) !== null) {
      ids.add(match[1]);
    }
  }
  return ids;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const junkIds = await pruneAutoAttachedJunk(dryRun);
  const posts = await prisma.post.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      content: true,
      contentEn: true,
      videos: {
        // 与文章页展示顺序一致：sortOrder 优先，其余按创建时间
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        select: { id: true, title: true, summary: true }
      }
    }
  });

  let postsChanged = 0;
  let redistributed = 0;
  let danglingRemoved = 0;
  let placeholdersRemoved = 0;

  for (const post of posts) {
    // dry-run 时垃圾行还没真正删除，这里显式过滤，让两种模式看到同一结果。
    const videos = post.videos.filter((video) => !junkIds.has(video.id));
    const attachedIds = new Set(videos.map((video) => video.id));
    const referencedIds = collectShortcodeIds(post.content, post.contentEn);

    // 悬空短代码：正文引用但 Video 行已不存在（会渲染成"未找到视频"占位框）。
    // 引用了其他文章视频的跨文章内嵌是受支持的用法，保持不动。
    const foreignIds = [...referencedIds].filter((id) => !attachedIds.has(id));
    const existingForeign = foreignIds.length
      ? await prisma.video.findMany({ where: { id: { in: foreignIds } }, select: { id: true } })
      : [];
    const existingForeignIds = new Set(existingForeign.map((video) => video.id));
    const danglingIds = foreignIds.filter((id) => !existingForeignIds.has(id) || junkIds.has(id));

    const rewrite = (markdown: string) => {
      let next = markdown;
      // 先剥掉旧短代码（悬空的和将要重新分布的），再判占位小节——
      // 否则「相关视频」小节因还残留短代码会被当成"有实际内容"而留下。
      for (const id of danglingIds) next = removeVideoShortcode(next, id);
      for (const video of videos) next = removeVideoShortcode(next, video.id);
      const beforePlaceholder = next;
      next = removePlaceholderVideoSections(next);
      const placeholderRemoved = next !== beforePlaceholder;
      next = distributeVideoShortcodes(next, videos);
      return { next, placeholderRemoved };
    };

    const zh = rewrite(post.content);
    const en = post.contentEn ? rewrite(post.contentEn) : null;

    const data: { content?: string; contentEn?: string } = {};
    if (zh.next !== post.content) data.content = zh.next;
    if (en && en.next !== post.contentEn) data.contentEn = en.next;
    if (!data.content && !data.contentEn) continue;

    postsChanged += 1;
    redistributed += videos.length;
    danglingRemoved += danglingIds.length;
    if (zh.placeholderRemoved || en?.placeholderRemoved) placeholdersRemoved += 1;

    if (!dryRun) {
      await prisma.post.update({ where: { id: post.id }, data });
    }
    const details = [
      videos.length ? `${videos.length} 个视频重新分布` : null,
      danglingIds.length ? `${danglingIds.length} 个悬空短代码清除` : null,
      zh.placeholderRemoved || en?.placeholderRemoved ? "占位小节移除" : null
    ].filter(Boolean).join("，");
    console.log(`${dryRun ? "[dry-run] " : ""}${post.slug} — ${details}`);
  }

  console.log(
    `${dryRun ? "Dry run" : "Repair"} complete: ${postsChanged}/${posts.length} post(s) changed, ` +
    `${redistributed} video(s) redistributed, ${danglingRemoved} dangling shortcode(s), ` +
    `${placeholdersRemoved} placeholder section(s) removed, ${junkIds.size} junk video(s) pruned.`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
