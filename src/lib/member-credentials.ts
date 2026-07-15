export const MEMBER_PASSWORD_MIN_LENGTH = 12;
export const MEMBER_PASSWORD_MAX_LENGTH = 100;

/**
 * 会员密码必须足够长，并至少覆盖大小写字母、数字、符号中的三类。
 * 返回面向用户的错误；null 表示可用。
 */
export function memberPasswordProblem(password: string, account?: string): string | null {
  if (password.length < MEMBER_PASSWORD_MIN_LENGTH) {
    return `密码至少 ${MEMBER_PASSWORD_MIN_LENGTH} 位`;
  }
  if (password.length > MEMBER_PASSWORD_MAX_LENGTH) {
    return `密码最多 ${MEMBER_PASSWORD_MAX_LENGTH} 位`;
  }

  const categories = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9\s]/.test(password)
  ].filter(Boolean).length;
  if (categories < 3) {
    return "密码需包含大写字母、小写字母、数字、符号中的至少三类";
  }

  const normalizedAccount = account?.trim().toLocaleLowerCase();
  if (normalizedAccount && password.toLocaleLowerCase().includes(normalizedAccount)) {
    return "密码不能包含账号名";
  }
  return null;
}

export function publicMemberRegistrationEnabled() {
  return process.env.ALLOW_PUBLIC_MEMBER_REGISTRATION === "true";
}
