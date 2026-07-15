import { prisma } from "../src/lib/prisma";
import { buildKeywordResearchUrl } from "../src/lib/research";
import { getResearchQueue } from "../src/lib/queue";

async function main() {
  const keyword = process.argv[2] || "英伟达 财报 数据中心 收入";
  const scope = (process.argv[3] || "international") as "domestic" | "international" | "all";
  const depth = (process.argv[4] || "long") as "standard" | "long" | "deep";
  const count = Number(process.argv[5] || "1");

  const modelConfig = await prisma.modelConfig.findFirst({ where: { isDefault: true, isEnabled: true } });
  const style = await prisma.contentStyle.findFirst({ orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] });
  if (!modelConfig || !style) { console.log("missing model/style"); return; }

  const topic = await prisma.contentTopic.findFirst({ where: { name: "科技" } });

  const job = await prisma.fetchJob.create({
    data: {
      sourceUrl: buildKeywordResearchUrl(keyword, scope, count, depth),
      sourceType: "WEB",
      modelConfigId: modelConfig.id,
      contentStyleId: style.id,
      contentTopicId: topic?.id ?? null
    }
  });
  const queue = getResearchQueue();
  await queue.add("fetch", { fetchJobId: job.id }, { priority: 1 });
  await queue.close();
  console.log(`ENQUEUED jobId=${job.id} keyword="${keyword}" scope=${scope} depth=${depth} count=${count}`);
  await prisma.$disconnect();
  // getSharedQueue 共享的 IORedis 生产者连接设计上不随 Queue.close() 关闭
  //（长驻进程复用它）。一次性 CLI 必须显式退出，否则事件循环被连接挂住，
  // docker exec 永不返回。
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
