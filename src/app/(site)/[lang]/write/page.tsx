import { localizedAlternates } from "@/lib/language";
import { setRequestLanguage } from "@/lib/i18n-server";
import type { Metadata } from "next";
import { WritingStudio } from "@/components/writing/WritingStudio";

// 纯客户端外壳：无服务端数据，整页构建期预渲染，命中即静态直出。
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const language = setRequestLanguage((await params).lang);
  return {
    title: "写作台",
    description: "可完全纯手写的 Notion 式写作台：块编辑、自动保存与 Markdown 导出；AI 辅助仅在用户主动开启和选择时调用。",
    alternates: localizedAlternates(language, "/write")
  };
}

export default function WritePage() {
  return (
    <main className="container writing-page">
      <WritingStudio />
    </main>
  );
}
