import { normalizePage } from "./pagination";

type SearchValue = string | string[] | undefined;
export type PostSearchParams = { topic?: SearchValue; q?: SearchValue; page?: SearchValue };
const first = (value: SearchValue) => (Array.isArray(value) ? value[0] : value);

export function parsePostFilters(params: PostSearchParams) {
  return {
    topic: first(params.topic)?.trim().slice(0, 200) || null,
    query: first(params.q)?.trim().slice(0, 120) || "",
    page: normalizePage(first(params.page))
  };
}

export function buildPostsHref(topic: string | null, query: string, page?: number) {
  const params = new URLSearchParams();
  if (topic) params.set("topic", topic);
  if (query) params.set("q", query);
  if (page && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/posts?${qs}` : "/posts";
}
