import { redirect } from "next/navigation";

export default async function NewsDetailRedirectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/posts/${encodeURIComponent(slug)}`);
}
