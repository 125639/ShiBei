-- 邀请码不再作为长期登录凭据；存量邀请码会员先进入受限的密码升级流程。
CREATE TYPE "MemberCredentialState" AS ENUM ('ACTIVE', 'LEGACY_INVITE_UPGRADE_REQUIRED');

ALTER TABLE "MemberUser"
  ADD COLUMN "credentialState" "MemberCredentialState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- 历史上所有与 USED 邀请码绑定的会员，passwordHash 都是 bcrypt(邀请码)。
-- 标记后，旧邀请码只可换取一个十分钟、仅能设置新密码的受限 cookie，不能建立会员会话。
UPDATE "MemberUser" AS member
SET "credentialState" = 'LEGACY_INVITE_UPGRADE_REQUIRED'
WHERE EXISTS (
  SELECT 1
  FROM "InviteCode" AS invite
  WHERE invite."memberId" = member."id"
    AND invite."status" = 'USED'
);

-- USED / REVOKED 码不可恢复地从明文字段移除。会员旧码的校验只依赖 bcrypt hash；
-- 完成升级后该 hash 也会被用户自设密码替换。
UPDATE "InviteCode"
SET "code" = '__RETIRED_' || "status" || '_' || "id"
WHERE "status" IN ('USED', 'REVOKED');
