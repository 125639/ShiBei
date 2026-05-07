import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/crypto";
import { seedDefaultTopics } from "../src/lib/topics";
import { seedDefaultModules } from "../src/lib/source-modules";
import { shouldSeedAiModel } from "./seed-helpers.mjs";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "change-me-now";

  await prisma.siteSettings.upsert({
    where: { id: "site" },
    update: {},
    create: {
      id: "site",
      name: "拾贝 信息博客",
      description: "抓取信息、AI 整理、人工审核发布的个人博客。",
      ownerName: "管理员",
      autoPublish: false
    }
  });

  await prisma.adminUser.upsert({
    where: { username },
    update: {},
    create: {
      username,
      passwordHash: await bcrypt.hash(password, 12)
    }
  });

  await prisma.summaryStyle.upsert({
    where: { id: "default-style" },
    update: {},
    create: {
      id: "default-style",
      name: "默认新闻总结",
      tone: "客观新闻",
      length: "中",
      focus: "事实, 影响, 技术细节, 商业价值",
      outputStructure: "标题, 摘要, 关键点, 背景, 来源, 相关视频",
      promptTemplate: "请将输入材料整理为中文新闻总结。保持事实清晰，不编造未出现的信息。输出 Markdown，包含：标题、摘要、关键点、背景、影响、来源链接。",
      isDefault: true
    }
  });

  await seedDefaultTopics(prisma);
  await seedDefaultModules(prisma);

  // scripts/init.sh 写入的 INIT_AI_* 在首次 seed 时落盘为默认 ModelConfig。
  // shouldSeedAiModel 兼任输入校验 + 幂等守卫：已经有任何模型配置时不重复写。
  const existingCount = await prisma.modelConfig.count();
  const aiInput = shouldSeedAiModel(process.env as Record<string, string | undefined>, existingCount);
  if (aiInput) {
    await prisma.modelConfig.create({
      data: {
        provider: aiInput.provider,
        name: aiInput.name,
        baseUrl: aiInput.baseUrl,
        model: aiInput.model,
        apiKeyEnc: encryptSecret(aiInput.apiKey),
        isDefault: true
      }
    });
    console.log(`[seed] 已写入默认 AI 模型: ${aiInput.provider}`);
  }
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
