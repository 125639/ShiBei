import type { Metadata } from "next";
import { WritingStudio } from "@/components/writing/WritingStudio";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "写作台",
  description: "可完全纯手写的 Notion 式写作台：块编辑、自动保存与 Markdown 导出；AI 辅助仅在用户主动开启和选择时调用。",
  alternates: { canonical: "/write" }
};

export default function WritePage() {
  return (
    <main className="container writing-page">
      <WritingStudio />
    </main>
  );
}
