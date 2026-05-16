import { redirect } from "next/navigation";

export default async function NewsRedirectPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const topic = typeof params.topic === "string" ? `?topic=${encodeURIComponent(params.topic)}` : "";
  redirect(`/posts${topic}`);
}
