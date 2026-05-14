import { rewriteRemoteArticleImageSources } from "../src/lib/article-image-cache";
import { prisma } from "../src/lib/prisma";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const posts = await prisma.post.findMany({
    select: {
      id: true,
      title: true,
      sourceUrl: true,
      content: true,
      contentEn: true
    }
  });

  let postsChanged = 0;
  let imagesChanged = 0;
  let imagesSkipped = 0;

  for (const post of posts) {
    if (dryRun) {
      const remoteImages = countRemoteImageSources(post.content) + (post.contentEn ? countRemoteImageSources(post.contentEn) : 0);
      if (remoteImages > 0) {
        postsChanged += 1;
        imagesChanged += remoteImages;
        console.log(`[dry-run] would inspect ${remoteImages} remote image(s) for: ${post.title}`);
      }
      continue;
    }

    const rewrittenZh = await rewriteRemoteArticleImageSources(post.content, {
      sourcePageUrl: post.sourceUrl
    });
    const rewrittenEn = post.contentEn
      ? await rewriteRemoteArticleImageSources(post.contentEn, { sourcePageUrl: post.sourceUrl })
      : null;

    const data: { content?: string; contentEn?: string } = {};
    if (rewrittenZh.html !== post.content) data.content = rewrittenZh.html;
    if (rewrittenEn && rewrittenEn.html !== post.contentEn) data.contentEn = rewrittenEn.html;

    imagesChanged += rewrittenZh.changed + (rewrittenEn?.changed || 0);
    imagesSkipped += rewrittenZh.skipped + (rewrittenEn?.skipped || 0);

    if (!data.content && !data.contentEn) continue;
    postsChanged += 1;
    if (!dryRun) {
      await prisma.post.update({
        where: { id: post.id },
        data
      });
    }
    console.log(`${dryRun ? "[dry-run] " : ""}rewrote images for: ${post.title}`);
  }

  console.log(
    dryRun
      ? `Dry run complete: ${postsChanged} post(s), ${imagesChanged} remote image URL(s) found.`
      : `Repair complete: ${postsChanged} post(s), ${imagesChanged} image URL(s) cached, ${imagesSkipped} skipped.`
  );
}

function countRemoteImageSources(html: string) {
  return [...html.matchAll(/<img\b[^>]*?\bsrc=(["'])https?:\/\/[^"']+\1[^>]*>/gi)].length;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
