import { memberPasswordProblem } from "./member-credentials";

export const ADMIN_USERNAME_MIN_LENGTH = 3;
export const ADMIN_USERNAME_MAX_LENGTH = 80;

export function normalizeAdminUsername(value: string) {
  return value.trim();
}

export function adminUsernameProblem(username: string): string | null {
  if (username.length < ADMIN_USERNAME_MIN_LENGTH || username.length > ADMIN_USERNAME_MAX_LENGTH) {
    return `用户名需为 ${ADMIN_USERNAME_MIN_LENGTH}–${ADMIN_USERNAME_MAX_LENGTH} 个字符`;
  }
  if (/[\u0000-\u001f\u007f]/.test(username)) return "用户名不能包含控制字符";
  return null;
}

export function adminPasswordProblem(password: string, username: string): string | null {
  return memberPasswordProblem(password, username);
}
