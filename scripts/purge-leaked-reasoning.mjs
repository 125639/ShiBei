// One-off helper: 扫描所有 Post.content / Post.contentEn,识别 LLM 思考流
// 被当作正文落库的污染数据,把命中的 PUBLISHED/ARCHIVED 记录改回 DRAFT,
// 让管理员手动处理。
//
// 起因: src/lib/ai.ts 之前的 reasoning_content 兜底逻辑会把 reasoning 模
// 型(Kimi-k2.6 / DeepSeek-R1 / o1 / o3 / o4)的思考链当成正文——当模型在
// 思考流里复述 prompt 时,prompt 本身就被原样渲染给读者(例如以"用户要求
// 我...让我先分析...选题关键词：..."开头的正文)。该兜底已删除,本脚本
// 处理存量。
//
// Usage:
//   node scripts/purge-leaked-reasoning.mjs           # dry-run, 只打印命中
//   node scripts/purge-leaked-reasoning.mjs --apply   # 实际把 status 改为 DRAFT
//
// 读 DATABASE_URL from env or .env。

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 强 marker: 出现这些字眼几乎不可能是合法的新闻正文。它们要么是 prompt
// 字段名(只在 src/lib/ai.ts 拼装的 user prompt 里出现),要么是模型思考流
// 的开场白。
const STRONG_MARKERS = [
  "选题关键词：",
  "本次任务计划生成",
  "报道长度：长报道",
  "报道长度：标准报道",
  "报道长度：深度报道",
  "输出结构偏好：",
  "用户要求我",
  "让我先分析",
  "让我分析一下"
];

// 只检测 content 的前 N 个字符,避免末尾"参考来源"区域里偶发字眼误伤。
const HEAD_LEN = 1200;

function detectLeak(text) {
  if (!text) return null;
  const head = text.slice(0, HEAD_LEN);
  for (const marker of STRONG_MARKERS) {
    if (head.includes(marker)) return marker;
  }
  return null;
}

function previewLine(text) {
  if (!text) return "";
  return text.slice(0, 160).replace(/\s+/g, " ").trim();
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "[apply] 实际更新 status -> DRAFT" : "[dry-run] 只列出命中,加 --apply 才改库");

  const posts = await prisma.post.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      content: true,
      contentEn: true,
      createdAt: true
    }
  });
  console.log(`扫描 ${posts.length} 篇 Post...`);

  const hits = [];
  for (const post of posts) {
    const zh = detectLeak(post.content);
    const en = detectLeak(post.contentEn);
    if (zh || en) hits.push({ post, zh, en });
  }

  console.log(`命中 ${hits.length} 篇:\n`);
  for (const { post, zh, en } of hits) {
    const reason = [zh && `zh="${zh}"`, en && `en="${en}"`].filter(Boolean).join(" ");
    console.log(`  ${post.id} [${post.status}] /${post.slug}`);
    console.log(`    标题: ${post.title}`);
    console.log(`    命中: ${reason}`);
    console.log(`    创建: ${post.createdAt.toISOString()}`);
    console.log(`    预览: ${previewLine(post.content)}`);
    console.log("");
  }

  if (!apply) {
    console.log("(dry-run 完成,未改动数据库。确认无误后加 --apply 重跑,会把命中的 PUBLISHED/ARCHIVED Post 改为 DRAFT。)");
    return;
  }

  let changed = 0;
  let skipped = 0;
  for (const { post } of hits) {
    if (post.status === "DRAFT") {
      skipped++;
      continue;
    }
    await prisma.post.update({
      where: { id: post.id },
      data: { status: "DRAFT" }
    });
    changed++;
  }
  console.log(`已把 ${changed} 篇命中的 Post 改为 DRAFT(${skipped} 篇本就是 DRAFT,跳过)。`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
