import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";
import { CreationStudio } from "@/components/CreationStudio";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "共创工作室",
  description: "AI 访谈式创作：2-3 问快速生成文章，或用 8-10 问深度成文；草稿可编辑，始终由你决定是否公开。",
  alternates: { canonical: "/create" }
};

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
