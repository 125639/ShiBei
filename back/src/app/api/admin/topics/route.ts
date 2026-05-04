import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";
import { syncSchedule } from "@/lib/scheduler";

const VALID_SCOPES = new Set(["all", "domestic", "international"]);
const VALID_DEPTHS = new Set(["standard", "long", "deep"]);
const VALID_KINDS = new Set(["SINGLE_ARTICLE", "DAILY_DIGEST", "WEEKLY_ROUNDUP"]);

function normalizeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

export async function POST(request: Request) {
  await requireAdmin();
  const form = await request.formData();

  const name = String(form.get("name") || "").trim();
  const rawSlug = String(form.get("slug") || "").trim();
  const slug = normalizeSlug(rawSlug || name);
  const scope = String(form.get("scope") || "all");
  const compileKind = String(form.get("compileKind") || "SINGLE_ARTICLE");
  const depth = String(form.get("depth") || "long");
  const articleCount = clampInt(Number(form.get("articleCount") || 1), 1, 5, 1);
  const keywords = String(form.get("keywords") || "").trim();
  const styleIdRaw = String(form.get("styleId") || "");
  const styleId = styleIdRaw === "" ? null : styleIdRaw;
  const cron = String(form.get("cron") || "0 9 * * *").trim();
  const isEnabled = form.get("isEnabled") === "true";

  if (!name || !slug || !keywords) {
    return redirectTo("/admin/auto-curation");
  }
  if (!VALID_SCOPES.has(scope) || !VALID_DEPTHS.has(depth) || !VALID_KINDS.has(compileKind)) {
    return redirectTo("/admin/auto-curation");
  }

  const topic = await prisma.newsTopic.create({
    data: {
      name,
      slug,
      scope,
      keywords,
      // Prisma will accept the string and validate against the enum at runtime.
      compileKind: compileKind as "SINGLE_ARTICLE" | "DAILY_DIGEST" | "WEEKLY_ROUNDUP",
      depth,
      articleCount,
      styleId,
      isEnabled
    }
  });

  const schedule = await prisma.autoSchedule.create({
    data: {
      topicId: topic.id,
      cron,
      isEnabled
    }
  });

  await syncSchedule(schedule.id);

  return redirectTo("/admin/auto-curation");
}
