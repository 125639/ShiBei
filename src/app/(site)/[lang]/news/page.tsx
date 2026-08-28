import { redirect } from "next/navigation";
import { localizeHref } from "@/lib/language";
import { setRequestLanguage } from "@/lib/i18n-server";

// /news 是 /posts 的历史别名。重定向必须落回**当前语言段**，否则英文读者
// 点进旧链接会被 proxy 按 Accept-Language 重新协商，可能被甩回中文。
export default async function NewsRedirectPage({
  params,
  searchParams
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { lang } = await params;
  const language = setRequestLanguage(lang);
  const query = await searchParams;
  const topic = typeof query.topic === "string" ? `?topic=${encodeURIComponent(query.topic)}` : "";
  redirect(localizeHref(language, `/posts${topic}`));
}
