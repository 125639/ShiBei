import type { Metadata } from "next";
import { I18nText } from "@/components/I18nText";
import { WritingWorkspace } from "@/components/WritingWorkspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "个人写作",
  description: "独立写作工作台：AI 辅助写作，内容不计入博客，可下载保存。",
  alternates: { canonical: "/write" }
};

export default function WritePage() {
  return (
    <main className="container bento-page">
      <section className="page-intro bento-card bento-wide">
        <p className="eyebrow">Writing</p>
        <h1 className="page-title"><I18nText zh="个人写作" en="Personal Writing" /></h1>
        <p className="muted-block">
          <I18nText
            zh="这个页面给用户临时写作使用，不会把内容计入博客文章。写完后可以下载 Markdown 文件自行保存。"
            en="A scratch space for your own writing — nothing here is published to the blog. Download your work as a Markdown file when you're done."
          />
        </p>
      </section>
      <WritingWorkspace />
    </main>
  );
}
