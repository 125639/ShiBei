const BOOTSTRAP_URL = "/api/public/anon/bootstrap";
const BOOTSTRAP_HEADER = "X-Shibei-Anon-Bootstrap";
const DB_NAME = "shibei-anon-bootstrap-v1";
const STORE_NAME = "bootstrap";
const SEED_KEY = "pending-seed";
const LOCK_NAME = "shibei-anon-bootstrap-v1";
const LOCAL_SEED_KEY = "shibei-anon-bootstrap-v1:pending-seed";
export const ANON_CREATION_SEED_HEADER = "X-Shibei-Anon-Seed";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type IndexedSeed = {
  seed: string;
  clear: () => Promise<void>;
  close: () => void;
};

let bootstrapPromise: Promise<string> | null = null;

/**
 * 所有会读取/自动创建匿名内容的客户端入口都必须先 await 此屏障。
 * 只复用仍在进行中的 Promise；成功后不能永久缓存，因为用户或浏览器可能在不
 * 刷新页面的情况下清除 HttpOnly cookie。跨标签页由 IndexedDB 单一 readwrite
 * transaction 原子 get-or-create，因而并发 bootstrap 会提交相同 seed。
 */
export function ensureAnonymousBootstrap(): Promise<string> {
  if (bootstrapPromise) return bootstrapPromise;
  const pending = runBootstrap();
  bootstrapPromise = pending;
  void pending.then(
    () => {
      if (bootstrapPromise === pending) bootstrapPromise = null;
    },
    () => {
      if (bootstrapPromise === pending) bootstrapPromise = null;
    }
  );
  return pending;
}

async function runBootstrap() {
  let indexed: IndexedSeed;
  try {
    indexed = await acquireIndexedSeed();
  } catch {
    return bootstrapWithWebLock();
  }

  try {
    await submitBootstrap(indexed.seed);
    // Cookie 已在 fetch resolve 前进入共享 cookie jar。只删除仍属于本次请求的 seed，
    // 不会误删其他恢复流程写入的新值。
    await indexed.clear().catch(() => undefined);
    return indexed.seed;
  } finally {
    indexed.close();
  }
}

async function submitBootstrap(seed: string) {
  const response = await fetch(BOOTSTRAP_URL, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      [BOOTSTRAP_HEADER]: "1"
    },
    body: JSON.stringify({ seed })
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `匿名身份初始化失败（${response.status}）`);
  }
  // 必须消费响应体：不读完流，浏览器会把该请求一直算作进行中——
  // 网络面板/自动化里表现为永远 pending，还占着连接槽位。
  await response.json().catch(() => undefined);
}

async function acquireIndexedSeed(): Promise<IndexedSeed> {
  if (!globalThis.indexedDB) throw new Error("IndexedDB unavailable");
  const db = await openDatabase();
  try {
    const seed = await new Promise<string>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(SEED_KEY);
      let selected = "";

      request.onsuccess = () => {
        const current = typeof request.result === "string" && UUID_PATTERN.test(request.result)
          ? request.result
          : "";
        selected = current || secureUuid();
        if (!current) store.put(selected, SEED_KEY);
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve(selected);
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });

    return {
      seed,
      clear: () => clearIndexedSeed(db, seed),
      close: () => db.close()
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

function clearIndexedSeed(db: IDBDatabase, expectedSeed: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(SEED_KEY);
    request.onsuccess = () => {
      if (request.result === expectedSeed) store.delete(SEED_KEY);
    };
    request.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB cleanup failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB cleanup aborted"));
  });
}

/**
 * IndexedDB 被禁用时，以 Web Locks 串行整个“取 seed → HTTP → 清理”周期。
 * localStorage 让崩溃后的下一标签页复用 pending seed；localStorage 也不可用时，
 * Web Lock 本身仍保证后来的请求只会在前一响应（cookie 已落盘）之后运行。
 * 两种协调能力都不可用则失败关闭，不再自动 POST 制造孤儿。
 */
async function bootstrapWithWebLock(): Promise<string> {
  const locks = globalThis.navigator?.locks;
  if (!locks) {
    throw new Error("浏览器无法安全协调匿名身份，请刷新或升级浏览器后重试");
  }

  return locks.request(LOCK_NAME, { mode: "exclusive" }, async () => {
    let seed = "";
    let stored = false;
    try {
      const current = globalThis.localStorage?.getItem(LOCAL_SEED_KEY) || "";
      seed = UUID_PATTERN.test(current) ? current : secureUuid();
      if (!current) globalThis.localStorage?.setItem(LOCAL_SEED_KEY, seed);
      const confirmed = globalThis.localStorage?.getItem(LOCAL_SEED_KEY) || "";
      if (UUID_PATTERN.test(confirmed)) seed = confirmed;
      stored = true;
    } catch {
      seed = secureUuid();
    }

    await submitBootstrap(seed);
    if (stored) {
      try {
        if (globalThis.localStorage?.getItem(LOCAL_SEED_KEY) === seed) {
          globalThis.localStorage.removeItem(LOCAL_SEED_KEY);
        }
      } catch {
        // Cookie 已成功写入；残留 seed 下次仍会派生同一身份，不影响安全。
      }
    }
    return seed;
  });
}

function secureUuid(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("浏览器缺少安全随机数能力，无法初始化匿名身份");
  }
  if (typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
