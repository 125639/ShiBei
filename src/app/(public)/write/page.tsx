import type { Metadata } from "next";
import { WritingStudio } from "@/components/writing/WritingStudio";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "写作台",
  description: "Notion 式写作台：块编辑、斜杠命令、AI 润色与续写。内容自动保存，不计入博客文章。",
  alternates: { canonical: "/write" }
};

export default function WritePage() {
  return (
    <main className="container writing-page">
      <WritingStudio />
    </main>
  );
}
