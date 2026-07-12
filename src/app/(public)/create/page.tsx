import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";
import { CreationStudio } from "@/components/CreationStudio";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "共创工作室",
  description: "AI 访谈式创作：选题材定标尺，回答问题生成可编辑草稿，评分达标后由你决定是否公开。",
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
            zh="AI 通过访谈帮你把想法变成文章：选题材（同时确定评分标尺）→ 回答具体问题 → 生成可编辑草稿 → AI 评分反馈 → 达标后由你决定是否公开。全程默认私有。"
            en="Turn your ideas into articles through an AI interview: pick a genre (which sets the scoring rubric), answer concrete questions, edit the generated draft, get scored feedback, and publish only when you choose to. Private by default."
          />
        </p>
      </section>
      <CreationStudio />
    </main>
  );
}
