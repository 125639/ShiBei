import { decryptSecret } from "@/lib/crypto";
import { getSyncConfig, type SyncConfig, type SyncMode } from "@/lib/app-mode";
import { prisma } from "@/lib/prisma";

type ConfigSource = "settings" | "env" | "none";

export type ResolvedSyncConfig = SyncConfig & {
  settingsLoaded: boolean;
  backendUrlSource: ConfigSource;
  syncTokenSource: ConfigSource;
  syncTokenConfigured: boolean;
  syncTokenDecryptError?: string;
};

export function normalizeSyncMode(value: unknown): SyncMode {
  return String(value || "auto").trim().toLowerCase() === "manual" ? "manual" : "auto";
}

export function normalizeBackendUrl(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function normalizeSyncIntervalMinutes(value: unknown, fallback = 15): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), 1440);
}

export async function getResolvedSyncConfig(): Promise<ResolvedSyncConfig> {
  const env = getSyncConfig();
  let settingsLoaded = false;
  let decryptError: string | undefined;

  try {
    const settings = await prisma.siteSettings.findUnique({ where: { id: "site" } });
    settingsLoaded = true;
    const s = settings as {
      syncMode?: string | null;
      syncBackendUrl?: string | null;
      syncTokenEnc?: string | null;
      syncIntervalMinutes?: number | null;
    } | null;

    const backendUrl = normalizeBackendUrl(s?.syncBackendUrl) || env.backendUrl;
    let syncToken = env.syncToken;
    let syncTokenSource: ConfigSource = env.syncToken ? "env" : "none";

    if (s?.syncTokenEnc) {
      try {
        syncToken = decryptSecret(s.syncTokenEnc).trim();
        syncTokenSource = syncToken ? "settings" : syncTokenSource;
      } catch (err) {
        decryptError = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      mode: normalizeSyncMode(s?.syncMode || env.mode),
      backendUrl,
      syncToken,
      intervalMinutes: normalizeSyncIntervalMinutes(s?.syncIntervalMinutes ?? env.intervalMinutes, env.intervalMinutes),
      settingsLoaded,
      backendUrlSource: normalizeBackendUrl(s?.syncBackendUrl) ? "settings" : env.backendUrl ? "env" : "none",
      syncTokenSource,
      syncTokenConfigured: Boolean(syncToken),
      syncTokenDecryptError: decryptError,
    };
  } catch (err) {
    console.error("[sync] 读取 SiteSettings 失败,回退到环境变量:", err instanceof Error ? err.message : err);
    return {
      ...env,
      settingsLoaded,
      backendUrlSource: env.backendUrl ? "env" : "none",
      syncTokenSource: env.syncToken ? "env" : "none",
      syncTokenConfigured: Boolean(env.syncToken),
    };
  }
}

export function backendFetchInitForConfig(
  cfg: Pick<SyncConfig, "syncToken">,
  extra?: RequestInit
): RequestInit {
  const headers = new Headers(extra?.headers || {});
  if (cfg.syncToken) headers.set("Authorization", `Bearer ${cfg.syncToken}`);
  return { ...extra, headers };
}
