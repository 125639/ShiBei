import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 恒定时间比较 Authorization 头与期望的 `Bearer <token>`。
 *
 * 直接用 `===` 比较密钥会随匹配前缀长度提前返回，理论上给出计时侧信道。
 * 这里把两边各自 SHA-256 到定长再用 timingSafeEqual：既避免了长度不等时
 * timingSafeEqual 抛错，也不泄露 token 长度。token 为空时一律判否——
 * 未配置密钥绝不能被空/任意头通过。
 */
export function bearerTokenMatches(
  authorizationHeader: string | null | undefined,
  token: string | null | undefined
): boolean {
  if (!token) return false;
  const got = createHash("sha256").update(authorizationHeader || "").digest();
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  return timingSafeEqual(got, expected);
}
