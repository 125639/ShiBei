-- 管理员对已公开社区作品的下架/删除必须留下持久、不可随作品删除的审计快照。
CREATE TYPE "CommunityModerationAction" AS ENUM ('UNPUBLISH', 'DELETE');

CREATE TABLE "CommunityModerationLog" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "action" "CommunityModerationAction" NOT NULL,
  "reason" TEXT NOT NULL,
  "targetWorkId" TEXT NOT NULL,
  "titleSnapshot" TEXT NOT NULL,
  "slugSnapshot" TEXT,
  "wasAnonymous" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommunityModerationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunityModerationLog_createdAt_idx"
ON "CommunityModerationLog"("createdAt");

CREATE INDEX "CommunityModerationLog_adminId_createdAt_idx"
ON "CommunityModerationLog"("adminId", "createdAt");

CREATE INDEX "CommunityModerationLog_targetWorkId_createdAt_idx"
ON "CommunityModerationLog"("targetWorkId", "createdAt");

ALTER TABLE "CommunityModerationLog"
ADD CONSTRAINT "CommunityModerationLog_adminId_fkey"
FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
