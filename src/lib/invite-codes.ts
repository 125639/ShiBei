import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";

// 邀请码格式 SB-XXXX-XXXX:去掉易混字符(0/O、1/I/L)的字母表,
// 手抄、口述都不容易错。8 位有效字符 ≈ 31^8 ≈ 8.5e11 组合,
// 配合注册限流,枚举不可行。
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateInviteCode(): string {
  const bytes = randomBytes(8);
  let raw = "";
  for (let i = 0; i < 8; i++) raw += ALPHABET[bytes[i] % ALPHABET.length];
  return `SB-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function isInviteCodeFormat(value: string): boolean {
  return /^SB-[23456789A-HJKMNP-Z]{4}-[23456789A-HJKMNP-Z]{4}$/.test(value);
}

/** 规范化用户输入:去空白、统一大写、容忍漏写连字符。 */
export function normalizeInviteCodeInput(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (/^SB[23456789A-HJKMNP-Z]{8}$/.test(compact)) {
    return `SB-${compact.slice(2, 6)}-${compact.slice(6)}`;
  }
  return value.trim().toUpperCase();
}

/**
 * 历史邀请码密码升级专用：只把确实像邀请码的大小写/空格/连字符变体
 * 归一成旧 passwordHash 当初使用的标准形式，普通新密码返回 null。
 */
export function normalizeLegacyInvitePasswordCandidate(value: string): string | null {
  const normalized = normalizeInviteCodeInput(value);
  return isInviteCodeFormat(normalized) ? normalized : null;
}

/** 已使用/作废的邀请码在数据库中的不可还原占位值。 */
export function retiredInviteCode(id: string, status: "USED" | "REVOKED"): string {
  return `__RETIRED_${status}_${id}`;
}

/** 后台列表只允许看到仍可发放的 UNUSED 原码。 */
export function inviteCodeForAdmin(status: string, code: string): string | null {
  return status === "UNUSED" && isInviteCodeFormat(code) ? code : null;
}

export async function createInviteCodes(count: number, note: string): Promise<string[]> {
  const codes = new Set<string>();
  // 生成空间巨大,冲突概率可忽略;仍循环补足以防万一
  while (codes.size < count) codes.add(generateInviteCode());
  const list = [...codes].slice(0, count);
  await prisma.inviteCode.createMany({
    data: list.map((code) => ({ code, note })),
    skipDuplicates: true
  });
  // skipDuplicates 极小概率丢一两个:据实返回真正入库的
  const saved = await prisma.inviteCode.findMany({
    where: { code: { in: list } },
    select: { code: true }
  });
  return saved.map((row) => row.code);
}
