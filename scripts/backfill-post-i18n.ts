// 一次性回填，配合列表英文回填功能上线：
// 1) 修复历史机器摘要以标题文字开头的问题（旧推导逻辑只删 "#" 标记、保留标题文字，
//    列表卡片和详情页 lead 因此把标题重复了一遍）；只动「当前值 === 旧逻辑推导值」
//    的摘要，人工改过的摘要不会被覆盖。
// 2) 同样修复已整篇翻译文章的英文摘要（summaryEn 以 titleEn 开头时，从 contentEn 重算，不调模型）。
// 3) 给已发布文章补齐列表页需要的 titleEn/summaryEn（轻量翻译标题+摘要，不翻正文；
//    正文英文仍由详情页按需翻译生成）。
// 用法：
//   npm run repair:post-i18n                       # 实际写库 + 调模型翻译
//   npm run repair:post-i18n -- --dry-run          # 只报告将发生的变更，不写库不调模型
//   npm run repair:post-i18n -- --skip-translate   # 只修摘要，不调模型
//   npm run repair:post-i18n -- --limit 20         # 本次最多翻译 20 篇
// 本地跑需覆盖 DATABASE_URL 指向 docker postgres（见 DEPLOY_NOTES.md）。
import { prisma } from "../src/lib/prisma";
import { extractTitleAndSummary } from "../src/lib/post-derive";
import { translateTitleSummaryToEnglish } from "../src/lib/ai";
import { getModelConfigForUse } from "../src/lib/model-selection";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipTranslate = args.includes("--skip-translate");
const limitIndex = args.indexOf("--limit");
const translateLimit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Number.POSITIVE_INFINITY;

/** worker 旧版摘要推导，逐字复刻。用来识别「机器生成且未被人工改过」的摘要。 */
function legacySummary(markdown: string) {
  const plain = markdown
    .replace(/^#+\s+/gm, "")
    .replace(/[-*]\s+/g, "")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 220) || "AI 已生成草稿，请管理员审核。";
}

/** 宽松归一化，用于判断英文摘要是否以标题开头（忽略大小写、标点、空白）。 */
function looseNorm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "");
}

async function fixChineseSummaries() {
  const posts = await prisma.post.findMany({
    select: { id: true, title: true, summary: true, content: true }
  });
  let fixed = 0;
  for (const post of posts) {
    if (!post.content) continue;
    // 只有当前摘要与旧逻辑推导结果完全一致，才能断定它是机器生成的
    if (post.summary !== legacySummary(post.content)) continue;
    const derived = extractTitleAndSummary(post.content, post.title);
    if (derived.summary === post.summary) continue;
    fixed += 1;
    if (!dryRun) {
      await prisma.post.update({ where: { id: post.id }, data: { summary: derived.summary } });
    }
  }
  console.log(`[i18n] 中文摘要去标题重复：${dryRun ? "将修复" : "已修复"} ${fixed}/${posts.length} 篇`);
}

async function fixEnglishSummaries() {
  const posts = await prisma.post.findMany({
    where: { contentEn: { not: null }, titleEn: { not: null }, summaryEn: { not: null } },
    select: { id: true, titleEn: true, summaryEn: true, contentEn: true }
  });
  let fixed = 0;
  for (const post of posts) {
    const titleNorm = looseNorm(post.titleEn as string);
    // 归一化后太短的标题前缀碰撞风险高，直接跳过
    if (titleNorm.length < 6) continue;
    if (!looseNorm(post.summaryEn as string).startsWith(titleNorm)) continue;
    const derived = extractTitleAndSummary(post.contentEn as string, post.titleEn as string);
    if (!derived.summary || derived.summary === post.summaryEn) continue;
    fixed += 1;
    if (!dryRun) {
      await prisma.post.update({ where: { id: post.id }, data: { summaryEn: derived.summary } });
    }
  }
  console.log(`[i18n] 英文摘要去标题重复：${dryRun ? "将修复" : "已修复"} ${fixed}/${posts.length} 篇`);
}

async function backfillListTranslations() {
  const pending = await prisma.post.findMany({
    where: { status: "PUBLISHED", OR: [{ titleEn: null }, { summaryEn: null }] },
    orderBy: { publishedAt: "desc" },
    select: { id: true, title: true, summary: true },
    ...(Number.isFinite(translateLimit) ? { take: Math.max(Math.floor(translateLimit), 0) } : {})
  });
  if (!pending.length) {
    console.log("[i18n] 没有缺英文标题/摘要的已发布文章");
    return;
  }
  if (dryRun || skipTranslate) {
    console.log(`[i18n] ${pending.length} 篇已发布文章缺 titleEn/summaryEn（${dryRun ? "dry-run" : "--skip-translate"}，未调模型）`);
    return;
  }

  const modelConfig = await getModelConfigForUse("translation");
  if (!modelConfig) {
    throw new Error("未配置翻译模型，请先在管理后台完成模型配置");
  }

  let done = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let aborted = false;
  const queue = [...pending];

  async function drain() {
    while (!aborted) {
      const post = queue.shift();
      if (!post) return;
      try {
        const translated = await translateTitleSummaryToEnglish({
          modelConfig: modelConfig!,
          title: post.title,
          summary: post.summary
        });
        await prisma.post.update({
          where: { id: post.id },
          data: { titleEn: translated.title, summaryEn: translated.summary }
        });
        done += 1;
        consecutiveFailures = 0;
        if (done % 10 === 0) console.log(`[i18n] 已翻译 ${done}/${pending.length}`);
      } catch (error) {
        failed += 1;
        consecutiveFailures += 1;
        console.error(`[i18n] 翻译失败 post=${post.id}:`, error instanceof Error ? error.message : error);
        if (consecutiveFailures >= 5) {
          aborted = true;
          console.error("[i18n] 连续失败 5 次，中止本次回填；剩余文章会由 worker 周期任务继续补齐");
        }
      }
    }
  }

  // 小并发跑批：单篇只翻标题+摘要，3 路并发对模型端点压力可控
  await Promise.all([drain(), drain(), drain()]);
  console.log(`[i18n] 列表翻译回填完成：成功 ${done} 篇，失败 ${failed} 篇，剩余 ${queue.length} 篇`);
}

async function main() {
  if (dryRun) console.log("[i18n] dry-run 模式：不写库、不调模型");
  await fixChineseSummaries();
  await fixEnglishSummaries();
  await backfillListTranslations();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
