import { localizedAlternates } from "@/lib/language";
import { setRequestLanguage } from "@/lib/i18n-server";
import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";
import { CreationStudio } from "@/components/CreationStudio";

// 纯客户端外壳：无服务端数据，整页构建期预渲染，命中即静态直出。
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const language = setRequestLanguage((await params).lang);
  return {
    title: "共创工作室",
    description: "AI 访谈式创作：2-3 问快速生成文章，或用 8-10 问深度成文；草稿可编辑，始终由你决定是否公开。",
    alternates: localizedAlternates(language, "/create")
  };
}

export default function CreatePage() {
  return (
    <main className="container bento-page creation-page">
      <section className="page-intro bento-card bento-wide">
        <p className="eyebrow">Co-create</p>
        <h1 className="page-title"><I18nText zh="共创工作室" en="Co-creation Studio" /></h1>
        <p className="muted-block">
          <I18nText
            zh="AI 通过访谈帮你把想法变成文章：2-3 问适合只给大致方向后快速成文，8-10 问适合把观点与材料谈深。两档都会生成可编辑文章，再按选题时已明确的标尺检查，由你决定是否公开。全程默认私有。"
            en="Turn an initial direction into an editable article with a 2-3 question quick interview, or develop a more focused piece through 8-10 deeper questions. Both use the rubric shown up front, stay private by default, and are published only when you choose."
          />
        </p>
      </section>
      <CreationStudio />
    </main>
  );
}
