import { redirect } from "next/navigation";
import { localizeHref } from "@/lib/language";
import { setRequestLanguage } from "@/lib/i18n-server";

// 历史别名 /news/<slug> → /<lang>/posts/<slug>。保持语言段，理由同 ../page.tsx。
export default async function NewsDetailRedirectPage({
  params
}: {
  params: Promise<{ lang: string; slug: string }>;
}) {
  const { lang, slug } = await params;
  const language = setRequestLanguage(lang);
  redirect(localizeHref(language, `/posts/${encodeURIComponent(slug)}`));
}
