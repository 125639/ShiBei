/**
 * 本机演示环境引导：embedded-postgres 起一个本地库（免 Docker/免安装），
 * prisma db push 建表 → 官方 seed → 再灌几篇演示文章，
 * 让首页/文章/数据页在本机就有真实内容可看。
 *
 * 用法：node ShiBei/node_modules/tsx/dist/cli.mjs ShiBei/scripts/demo-db.ts
 * （数据目录 .demo-pg/，重复运行会复用；DATABASE_URL 见下方常量）
 */
import EmbeddedPostgres from "embedded-postgres";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, ".demo-pg");
const PORT = 55432;
export const DEMO_DATABASE_URL = `postgresql://shibei:shibei@localhost:${PORT}/shibei_blog`;

/** 极简 .env 解析：本脚本从 shell 直接启动，Next 的 env 加载不在场，
    而 seed.ts 依赖 ENCRYPTION_KEY / AUTH_SECRET 等。 */
function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
    }
  } catch {
    /* .env 缺失时靠调用方环境 */
  }
  return out;
}

async function main() {
  const fresh = !existsSync(DATA_DIR);
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "shibei",
    password: "shibei",
    port: PORT,
    persistent: true,
    // Windows 下以管理员运行时 initdb 拒绝 root 身份；一般用户无影响
    onLog: () => {},
    onError: () => {}
  });

  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("shibei_blog");

  const env = {
    ...loadDotEnv(),
    ...process.env,
    DATABASE_URL: DEMO_DATABASE_URL,
    ADMIN_PASSWORD: "demo-admin-pass",
    ADMIN_USERNAME: "admin"
  };

  // 建表（首次）/ 同步 schema（幂等）
  execSync(`node "${path.join(ROOT, "node_modules/prisma/build/index.js")}" db push --skip-generate`, {
    cwd: ROOT,
    env,
    stdio: "inherit"
  });

  // 官方 seed：站点设置 / 管理员 / 默认主题分类 / 创作体裁（全部 upsert，幂等）
  execSync(`node "${path.join(ROOT, "node_modules/tsx/dist/cli.mjs")}" prisma/seed.ts`, {
    cwd: ROOT,
    env,
    stdio: "inherit"
  });

  // 演示文章
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: DEMO_DATABASE_URL } } });

  const topics = await prisma.contentTopic.findMany({ select: { id: true, slug: true } });
  const bySlug = new Map(topics.map((t) => [t.slug, t.id]));
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const demoPosts: Array<{
    slug: string;
    title: string;
    summary: string;
    topic: string | undefined;
    daysAgo: number;
    tags: string[];
  }> = [
    { slug: "demo-ai-weekly", title: "AI 周报：多模态模型进入日常工作流", summary: "从代码助手到文档整理，多模态能力正在成为默认配置。本文梳理近一周值得关注的进展与争议。", topic: "ai", daysAgo: 0, tags: ["AI", "周报"] },
    { slug: "demo-tech-chips", title: "国产芯片新进展：制程与封装的双线突破", summary: "先进封装成为绕开制程瓶颈的现实路径，产业链上下游的协同正在加速。", topic: "technology", daysAgo: 1, tags: ["半导体"] },
    { slug: "demo-edu-reading", title: "深读时代：碎片信息之外的阅读方法", summary: "如何在信息洪流里保留深度阅读的能力？三个可操作的习惯与工具建议。", topic: "culture-edu", daysAgo: 2, tags: ["阅读", "方法论"] },
    { slug: "demo-economy-q2", title: "二季度消费数据解读：结构性回暖的三个信号", summary: "服务消费领跑、县域市场扩容、以旧换新拉动耐用品——数据背后的结构变化。", topic: "economy", daysAgo: 3, tags: ["宏观"] },
    { slug: "demo-society-city", title: "城市更新中的「15 分钟生活圈」实践", summary: "从概念到落地，多个城市的生活圈改造样本与居民真实反馈。", topic: "society", daysAgo: 4, tags: ["城市"] },
    { slug: "demo-intl-climate", title: "全球气候谈判的新变量：碳关税与产业博弈", summary: "碳边境调节机制进入实施期，出口导向型产业的应对策略盘点。", topic: "international", daysAgo: 5, tags: ["气候"] },
    { slug: "demo-ai-agents", title: "智能体元年：Agent 应用的能与不能", summary: "自动化工作流、长任务规划、工具调用——Agent 落地场景的边界在哪里？", topic: "ai", daysAgo: 6, tags: ["AI", "Agent"] },
    { slug: "demo-tech-opensource", title: "开源基础设施的可持续性难题", summary: "核心维护者流失、商业化路径分歧，开源生态的资金与治理模式再思考。", topic: "technology", daysAgo: 8, tags: ["开源"] }
  ];

  for (const p of demoPosts) {
    const topicId = p.topic ? bySlug.get(p.topic) : undefined;
    const publishedAt = new Date(now - p.daysAgo * DAY);
    const content = [
      `## 导语`,
      ``,
      p.summary,
      ``,
      `## 正文`,
      ``,
      `这是本地演示环境自动生成的示例文章，用于预览布局、过渡与统计图表。正式部署后，内容将由抓取 → AI 整理 → 人工审核流水线产出。`,
      ``,
      `- 要点一：演示列表与网格布局的换行与截断`,
      `- 要点二：演示标签、主题与时间元信息`,
      `- 要点三：演示 AI 助手的上下文提取`,
      ``,
      `> 引用块样式演示：清晰的排版是阅读体验的基础。`,
      ``,
      `### 小结`,
      ``,
      `切换顶部「美化」面板的色相与壁纸，观察全站即时响应。`
    ].join("\n");

    await prisma.post.upsert({
      where: { slug: p.slug },
      update: { publishedAt, createdAt: publishedAt },
      create: {
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        content,
        status: "PUBLISHED",
        kind: "SINGLE_ARTICLE",
        publishedAt,
        createdAt: publishedAt,
        tags: {
          connectOrCreate: p.tags.map((name) => ({ where: { name }, create: { name } }))
        },
        ...(topicId ? { topics: { connect: [{ id: topicId }] } } : {})
      }
    });
  }

  const count = await prisma.post.count({ where: { status: "PUBLISHED" } });
  await prisma.$disconnect();

  console.log(`\n✔ 演示库就绪：${count} 篇已发布文章`);
  console.log(`  DATABASE_URL=${DEMO_DATABASE_URL}`);
  console.log(`  管理员 admin / demo-admin-pass`);
  console.log(`  （embedded-postgres 进程随本脚本退出而停止，dev 前需保持运行或改用 start-demo）`);

  // 保持进程存活让 postgres 一直可用；Ctrl+C 时优雅关库
  const shutdown = async () => {
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.log("\n▶ Postgres 运行中（Ctrl+C 停止）…");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
