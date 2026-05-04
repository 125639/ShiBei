import { PublicShell } from "@/components/PublicShell";
import { prisma } from "@/lib/prisma";

export default async function AboutPage() {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });

  return (
    <PublicShell>
      <main className="container">
        <article className="prose">
          <h1>关于这个博客</h1>
          <p>
            {settings?.name || "拾贝 信息博客"} 是一个面向个人使用的信息整理博客。管理员可以接入 OpenAI-compatible 模型，选择默认或临时信息源，抓取网页与 RSS 内容，生成待审核草稿后再发布。
          </p>
          <p>
            这个系统强调人工审核：AI 负责提高整理效率，最终发布内容由管理员确认。公开视频资源可以与文章关联，用于补充背景材料或形成视频博客。
          </p>
        </article>
      </main>
    </PublicShell>
  );
}
