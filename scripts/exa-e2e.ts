/**
 * Exa end-to-end smoke test.
 *
 * Run inside the worker/app container so DATABASE_URL/REDIS_URL resolve:
 *   docker compose exec worker npx tsx scripts/exa-e2e.ts <KEYWORD>
 *
 * Steps: enable Exa + store key → sanity-check the search API → create/reuse a
 * test ContentTopic → enqueue a topic run → poll the FetchJob → print the
 * resulting draft Post.
 *
 * Pass --keep to retain the test topic after completion. Default behaviour
 * leaves topic + post around so you can inspect them in /admin.
 */
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/crypto";
import { searchWithExa } from "../src/lib/exa";
import { enqueueTopicRun } from "../src/lib/auto-curation";

const EXA_KEY = process.env.EXA_API_KEY || "54c87d1d-1503-466a-9b9e-1b1fc938edcf";
const KEYWORD = process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]) || "Claude Opus 4.7 发布";
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 8 * 60_000;

function log(stage: string, msg: string, extra?: unknown) {
  const ts = new Date().toISOString().split("T")[1].slice(0, 8);
  if (extra === undefined) console.log(`[${ts}] ${stage} ${msg}`);
  else console.log(`[${ts}] ${stage} ${msg}`, extra);
}

async function configureExa() {
  log("1/6", "writing exa key + enabling Exa in SiteSettings");
  const enc = encryptSecret(EXA_KEY);
  await prisma.siteSettings.upsert({
    where: { id: "site" },
    update: { exaEnabled: true, exaApiKeyEnc: enc },
    create: { id: "site", exaEnabled: true, exaApiKeyEnc: enc }
  });
}

async function probeExa() {
  log("2/6", `searchWithExa('${KEYWORD}')`);
  const results = await searchWithExa(KEYWORD, { numResults: 5 });
  log("    ", `→ ${results.length} results`);
  for (const r of results.slice(0, 5)) {
    console.log(`     • ${r.title} (${r.sourceName}) ${r.publishedDate?.toISOString().slice(0, 10) ?? ""}`);
    console.log(`       ${r.url}`);
  }
  if (!results.length) throw new Error("Exa returned no results — key/network problem?");
  return results;
}

async function ensureModel() {
  log("3/6", "checking ModelConfig for content generation");
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
  const cfgId = (settings as { contentModelConfigId?: string | null } | null)?.contentModelConfigId;
  const cfg = cfgId
    ? await prisma.modelConfig.findUnique({ where: { id: cfgId } })
    : (await prisma.modelConfig.findFirst({ where: { isDefault: true } })) ||
      (await prisma.modelConfig.findFirst());
  if (!cfg) throw new Error("No ModelConfig found — please configure an AI provider in /admin/settings first");
  log("    ", `→ ${cfg.provider}/${cfg.model} (id=${cfg.id})`);
  return cfg;
}

async function ensureTopic() {
  log("4/6", `creating/reusing test ContentTopic for keyword: ${KEYWORD}`);
  const slug = "exa-smoke-test";
  const existing = await prisma.contentTopic.findUnique({ where: { slug } });
  const style = await prisma.contentStyle.findFirst({ where: { isDefault: true } })
    || await prisma.contentStyle.findFirst();
  const data = {
    name: "Exa E2E Smoke Test",
    slug,
    scope: "all",
    keywords: KEYWORD,
    isEnabled: false,
    compileKind: "SINGLE_ARTICLE" as const,
    depth: "standard",
    articleCount: 1,
    useExa: true,
    styleId: style?.id ?? null
  };
  const topic = existing
    ? await prisma.contentTopic.update({ where: { id: existing.id }, data })
    : await prisma.contentTopic.create({ data });
  log("    ", `→ topic id=${topic.id}`);
  return topic;
}

async function waitForJob(topicId: string, startedAt: Date) {
  log("5/6", "polling FetchJob until COMPLETED (max 8 min)");
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const job = await prisma.fetchJob.findFirst({
      where: { contentTopicId: topicId, createdAt: { gte: startedAt } },
      orderBy: { createdAt: "desc" },
      include: { rawItems: { include: { post: true } } }
    });
    if (job) {
      const post = job.rawItems.find((ri) => ri.post)?.post ?? null;
      log("    ", `job=${job.status} post=${post ? post.id : "(none yet)"}`);
      if (job.status === "COMPLETED" || job.status === "FAILED") return { job, post };
    } else {
      log("    ", "no FetchJob yet…");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for FetchJob to complete");
}

async function main() {
  log("0/6", `keyword="${KEYWORD}"`);
  await configureExa();
  await probeExa();
  await ensureModel();
  const topic = await ensureTopic();

  const startedAt = new Date();
  log("    ", "enqueueTopicRun()");
  const enq = await enqueueTopicRun(topic.id);
  log("    ", `→ enqueued=${enq.enqueued} reason=${enq.reason}`);
  if (!enq.enqueued) throw new Error(`enqueueTopicRun did not enqueue (reason=${enq.reason})`);

  const { job, post } = await waitForJob(topic.id, startedAt);

  log("6/6", "result");
  console.log("================= FetchJob =================");
  console.log({ id: job.id, status: job.status, sourceUrl: job.sourceUrl, errorMessage: job.errorMessage });
  if (post) {
    console.log("================= Post =================");
    console.log({ id: post.id, slug: post.slug, status: post.status, title: post.title });
    console.log("---------------- content ----------------");
    console.log(post.content);
  } else {
    console.log("No Post was created.");
  }
}

main()
  .catch((err) => {
    console.error("[exa-e2e] FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
