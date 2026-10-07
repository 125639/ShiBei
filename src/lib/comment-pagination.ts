import { z } from "zod";

const CursorSchema = z.object({
  id: z.string().min(1).max(100),
  createdAt: z.string().datetime()
});

export function parseCommentCursor(value: string | null) {
  if (!value) return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid comment cursor");
  const decoded = CursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  return { id: decoded.id, createdAt: new Date(decoded.createdAt) };
}

export function encodeCommentCursor(row: { id: string; createdAt: Date }): string {
  return Buffer.from(JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() })).toString("base64url");
}

export function commentCursorWhere(cursor: ReturnType<typeof parseCommentCursor>) {
  return cursor ? { OR: [
    { createdAt: { gt: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { gt: cursor.id } }
  ] } : {};
}
