import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ownerExportScoreLabel, parseInterview } from "@/lib/creation";
import { actorOwnsWork, getCreationActor } from "@/lib/creation-server";

export const dynamic = "force-dynamic";

// 导出权完全归创作者：随时可以把作品（含访谈记录）下载为 Markdown。
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = await prisma.creativeWork.findUnique({ where: { id }, include: { genre: true } });
  if (!work || !actorOwnsWork(work, await getCreationActor())) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }

  const interview = parseInterview(work.interview);
  const scoreLabel = ownerExportScoreLabel(work);
  const lines = [
    `# ${work.title || work.topic}`,
    "",
    `> 题材：${work.genre.name} ｜ 创建：${work.createdAt.toISOString().slice(0, 10)}` +
      (scoreLabel ? ` ｜ ${scoreLabel}` : ""),
    ""
  ];
  if (work.summary) lines.push(work.summary, "");
  if (work.content) lines.push(work.content, "");
  if (interview.length > 0) {
    lines.push("---", "", "## 附：访谈记录", "");
    for (const [index, entry] of interview.entries()) {
      lines.push(`**问 ${index + 1}：${entry.question}**`, "", entry.answer, "");
    }
  }

  const filename = encodeURIComponent(`${(work.title || work.topic).slice(0, 60)}.md`);
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`
    }
  });
}
