import { isCompileKind, isResearchDepth, isResearchScope, type CompileKind, type ResearchDepth, type ResearchScope } from "@/lib/research";
import { slugify } from "@/lib/slug";

export type ParsedTopicForm = {
  name: string;
  slug: string;
  scope: ResearchScope;
  compileKind: CompileKind;
  depth: ResearchDepth;
  articleCount: number;
  keywords: string;
  styleId: string | null;
  cron: string;
  isEnabled: boolean;
};

export function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

export function parseTopicForm(form: FormData): ParsedTopicForm | null {
  const name = String(form.get("name") || "").trim();
  const rawSlug = String(form.get("slug") || "").trim();
  const scope = String(form.get("scope") || "all");
  const compileKind = String(form.get("compileKind") || "SINGLE_ARTICLE");
  const depth = String(form.get("depth") || "long");
  const keywords = String(form.get("keywords") || "").trim();
  const styleIdRaw = String(form.get("styleId") || "");

  if (!isResearchScope(scope) || !isResearchDepth(depth) || !isCompileKind(compileKind)) return null;

  return {
    name,
    slug: slugify(rawSlug || name),
    scope,
    compileKind,
    depth,
    articleCount: clampInt(Number(form.get("articleCount") || 1), 1, 5, 1),
    keywords,
    styleId: styleIdRaw === "" ? null : styleIdRaw,
    cron: String(form.get("cron") || "0 9 * * *").trim(),
    isEnabled: form.get("isEnabled") === "true"
  };
}
