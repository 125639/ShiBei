import type { Browser, BrowserContext } from "playwright";
import { assertSafeResolvedFetchUrl, isHttpUrl } from "./url-safety";
import { startPinnedEgressProxy } from "./pinned-egress-proxy";

export const SAFE_SCRAPING_CLOSE_TIMEOUT_MS = 5_000;

/**
 * Chromium must not resolve destination hosts itself. HTTP(S) is forced through
 * our pinned proxy; the resolver rule is a fail-closed backstop for any request
 * that Chromium might otherwise try to send directly.
 */
export const SAFE_CHROMIUM_LAUNCH_ARGS = [
  // The authenticated proxy itself is the only hostname-resolution exception.
  // It binds to this literal loopback address and performs the validated lookup.
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  "--proxy-bypass-list=<-loopback>",
  "--disable-quic",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"
] as const;

type BrowserContextOptions = NonNullable<Parameters<Browser["newContext"]>[0]>;

export type SafeScrapingContext = {
  context: BrowserContext;
  close: () => Promise<void>;
};

async function settleCleanupWithin(
  label: string,
  close: () => Promise<void>,
  timeoutMs: number
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = Promise.resolve()
    .then(close)
    // Cleanup is best-effort, matching the previous behavior. Observing the
    // rejection here also prevents a late rejection after the timeout from
    // becoming unhandled.
    .catch(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[browser-egress] ${label} cleanup exceeded ${timeoutMs}ms; continuing shutdown`);
      resolve();
    }, timeoutMs);
  });
  await Promise.race([cleanup, timeout]);
  if (timer) clearTimeout(timer);
}

/**
 * Start both cleanup paths immediately and put a deadline around Playwright's
 * RPC acknowledgement. The proxy's close() synchronously stops accepting new
 * connections and destroys its tracked sockets before waiting for Node's
 * server-close callback, so Chromium cannot retain outbound access if its own
 * context.close() RPC stops responding.
 *
 * Exported for a focused regression test; callers normally use
 * SafeScrapingContext.close().
 */
export async function closeSafeScrapingResources(
  closeContext: () => Promise<void>,
  closeProxy: () => Promise<void>,
  timeoutMs = SAFE_SCRAPING_CLOSE_TIMEOUT_MS
) {
  const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  await Promise.all([
    settleCleanupWithin("Chromium context", closeContext, boundedTimeoutMs),
    settleCleanupWithin("pinned proxy", closeProxy, boundedTimeoutMs)
  ]);
}

async function installRequestBoundary(context: BrowserContext) {
  // Service workers can otherwise issue requests outside page.route().
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    try {
      if (!isHttpUrl(requestUrl)) {
        if (requestUrl.startsWith("data:") || requestUrl.startsWith("blob:") || requestUrl === "about:blank") {
          await route.continue();
        } else {
          await route.abort("blockedbyclient");
        }
        return;
      }
      // This first check gives an early, explicit block. The local proxy repeats
      // DNS validation at connection time and connects to that exact IP result.
      await assertSafeResolvedFetchUrl(requestUrl);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient").catch(() => undefined);
    }
  });

  // Scraping never needs a bidirectional socket. Not connecting the routed
  // WebSocket makes Playwright serve a local mock instead of opening a socket.
  await context.routeWebSocket(/.*/, async (socket) => {
    await socket.close({ code: 1008, reason: "Blocked by outbound policy" });
  });

  // WebRTC can create UDP sockets independently from HTTP proxying. Disable its
  // page API in every frame in addition to Chromium's non-proxied-UDP policy.
  await context.addInitScript(() => {
    for (const key of ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport"] as const) {
      try {
        Object.defineProperty(globalThis, key, {
          configurable: false,
          value: undefined,
          writable: false
        });
      } catch {
        // A browser version may expose a non-configurable property already; the
        // launch-level network policy remains the fail-closed boundary.
      }
    }
  });
}

export async function createSafeScrapingContext(
  browser: Browser,
  options: BrowserContextOptions = {}
): Promise<SafeScrapingContext> {
  const proxy = await startPinnedEgressProxy();
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      ...options,
      serviceWorkers: "block",
      proxy: {
        server: proxy.serverUrl,
        username: proxy.username,
        password: proxy.password
      }
    });
    await installRequestBoundary(context);
  } catch (error) {
    await closeSafeScrapingResources(
      () => context?.close() ?? Promise.resolve(),
      () => proxy.close()
    );
    throw error;
  }

  const readyContext = context;
  let closePromise: Promise<void> | null = null;
  return {
    context: readyContext,
    close: () => {
      if (!closePromise) {
        closePromise = closeSafeScrapingResources(
          () => readyContext.close(),
          () => proxy.close()
        );
      }
      return closePromise;
    }
  };
}
