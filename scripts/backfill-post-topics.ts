/**
 * 存量文章分类回填：给所有没有 ContentTopic 的 Post 跑一遍词库归类器。
 *
 * 背景：来源抓取（web/rss）的文章历史上从不挂分类，前台「按主题分栏」
 * 因此对大多数文章失效。worker 已在建稿时自动归类（createDraftFromRawItem），
 * 本脚本负责补齐存量。幂等：已有分类的文章不动，重复运行无副作用。
 *
 * 运行：npm run repair:post-topics
 */
import { prisma } from "../src/lib/prisma";
import { classifyTopic, type ClassifiableTopic } from "../src/lib/topic-classify";

async function main() {
  // 不过滤 isEnabled：启停只控制定时自动生产，分类体系对全部主题有效。
  const topics: ClassifiableTopic[] = await prisma.contentTopic.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, name: true, keywords: true }
  });
  if (!topics.length) {
    console.log("没有 ContentTopic，先在后台「自动内容」里创建主题。");
    return;
  }

  const posts = await prisma.post.findMany({
    where: { topics: { none: {} }, status: { in: ["DRAFT", "PUBLISHED"] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      summary: true,
      content: true,
      status: true,
      rawItem: {
        select: { source: { select: { modules: { select: { slug: true } } } } }
      }
    }
  });
  console.log(`待归类文章：${posts.length} 篇；候选分类：${topics.map((t) => t.name).join(" / ")}`);

  const assignedBySlug = new Map<string, number>();
  let unmatched = 0;
  for (const post of posts) {
    const result = classifyTopic(
      {
        title: post.title,
        summary: post.summary,
        content: post.content,
        moduleSlugs: post.rawItem?.source?.modules.map((m) => m.slug) || []
      },
      topics
    );
    if (!result) {
      unmatched += 1;
      console.log(`  [无匹配] ${post.title.slice(0, 48)}`);
      continue;
    }
    await prisma.post.update({
      where: { id: post.id },
      data: { topics: { connect: { id: result.topicId } } }
    });
    assignedBySlug.set(result.slug, (assignedBySlug.get(result.slug) || 0) + 1);
  }

  console.log("\n== 回填结果 ==");
  for (const topic of topics) {
    const n = assignedBySlug.get(topic.slug) || 0;
    if (n) console.log(`  ${topic.name}: +${n}`);
  }
  console.log(`  已归类 ${posts.length - unmatched} / ${posts.length}，无匹配 ${unmatched} 篇（保持未分类）`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
