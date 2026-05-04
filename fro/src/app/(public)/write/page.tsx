import { PublicShell } from "@/components/PublicShell";
import { WritingWorkspace } from "@/components/WritingWorkspace";

export const dynamic = "force-dynamic";

export default function WritePage() {
  return (
    <PublicShell>
      <main className="container">
        <p className="eyebrow">Writing</p>
        <h1 className="page-title">个人写作</h1>
        <p className="muted-block" style={{ maxWidth: 760, margin: "16px 0 26px" }}>
          这个页面给用户临时写作使用，不会把内容计入博客文章。写完后可以下载 Markdown 文件自行保存。
        </p>
        <WritingWorkspace />
      </main>
    </PublicShell>
  );
}
