import { createHmac } from "node:crypto";
import { getAuthSecret } from "./auth";

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 512;

export class ListPaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListPaginationError";
  }
}

export type DescendingUpdatedAtCursor = {
  updatedAt: Date;
  id: string;
};

/**
 * Bind an opaque cursor to the active member/anonymous identity without ever
 * exposing the HttpOnly anonymous token to browser JavaScript.
 */
export function identityBoundListScope(
  list: string,
  identity: { memberId?: string | null; anonId?: string | null }
) {
  const identityValue = identity.memberId
    ? `member:${identity.memberId}`
    : identity.anonId
      ? `anon:${identity.anonId}`
      : "none";
  const digest = createHmac("sha256", getAuthSecret())
    .update(`${list}\0${identityValue}`)
    .digest("base64url")
    .slice(0, 32);
  return `${list}:${digest}`;
}

type CursorPayload = {
  v: typeof CURSOR_VERSION;
  scope: string;
  updatedAt: string;
  id: string;
};

function encodePayload(payload: CursorPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function encodeDescendingUpdatedAtCursor(
  scope: string,
  row: { updatedAt: Date | string; id: string }
) {
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
  if (!scope || !row.id || row.id.length > 200 || Number.isNaN(updatedAt.getTime())) {
    throw new ListPaginationError("无法生成列表游标");
  }
  return encodePayload({
    v: CURSOR_VERSION,
    scope,
    updatedAt: updatedAt.toISOString(),
    id: row.id
  });
}

export function decodeDescendingUpdatedAtCursor(
  scope: string,
  rawCursor: string | null
): DescendingUpdatedAtCursor | null {
  if (!rawCursor) return null;
  if (rawCursor.length > MAX_CURSOR_LENGTH) {
    throw new ListPaginationError("列表游标无效");
  }

  try {
    const parsed = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
    const keys = Object.keys(parsed);
    const updatedAt = typeof parsed.updatedAt === "string" ? new Date(parsed.updatedAt) : new Date(Number.NaN);
    if (
      keys.length !== 4
      || parsed.v !== CURSOR_VERSION
      || parsed.scope !== scope
      || typeof parsed.id !== "string"
      || !parsed.id
      || parsed.id.length > 200
      || Number.isNaN(updatedAt.getTime())
      || parsed.updatedAt !== updatedAt.toISOString()
    ) {
      throw new Error("invalid cursor payload");
    }
    return { updatedAt, id: parsed.id };
  } catch {
    throw new ListPaginationError("列表游标无效");
  }
}

export function parseListPageRequest(
  requestUrl: string,
  options: { scope: string; defaultPageSize: number; maxPageSize: number }
) {
  const url = new URL(requestUrl);
  const rawPageSize = url.searchParams.get("pageSize");
  const pageSize = rawPageSize === null ? options.defaultPageSize : Number(rawPageSize);
  if (
    !Number.isInteger(pageSize)
    || pageSize < 1
    || pageSize > options.maxPageSize
    || (rawPageSize !== null && !/^\d+$/.test(rawPageSize))
  ) {
    throw new ListPaginationError(`pageSize 必须是 1-${options.maxPageSize} 的整数`);
  }
  return {
    pageSize,
    cursor: decodeDescendingUpdatedAtCursor(options.scope, url.searchParams.get("cursor"))
  };
}

/**
 * Keyset boundary for `ORDER BY updatedAt DESC, id DESC`.
 * The id tie-breaker makes identical timestamps deterministic and prevents a
 * row from appearing on both adjacent pages.
 */
export function descendingUpdatedAtCursorWhere(cursor: DescendingUpdatedAtCursor | null) {
  if (!cursor) return {};
  return {
    OR: [
      { updatedAt: { lt: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }
    ]
  };
}

export function finishDescendingUpdatedAtPage<T extends { id: string; updatedAt: Date | string }>(
  scope: string,
  fetchedRows: T[],
  pageSize: number
) {
  const hasMore = fetchedRows.length > pageSize;
  const items = hasMore ? fetchedRows.slice(0, pageSize) : fetchedRows;
  const tail = items.at(-1);
  return {
    items,
    hasMore,
    nextCursor: hasMore && tail ? encodeDescendingUpdatedAtCursor(scope, tail) : null
  };
}
