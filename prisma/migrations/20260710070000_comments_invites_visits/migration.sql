-- 评论(默认关闭)+ 邀请码注册 + 访问统计

-- MemberUser:邮箱改可空,新增用户名(邀请码注册用)
ALTER TABLE "MemberUser" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "MemberUser" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "MemberUser_username_key" ON "MemberUser"("username");

-- 评论功能开关(默认关闭)
ALTER TABLE "SiteSettings" ADD COLUMN "commentsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNUSED',
    "note" TEXT NOT NULL DEFAULT '',
    "memberId" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");
CREATE UNIQUE INDEX "InviteCode_memberId_key" ON "InviteCode"("memberId");
CREATE INDEX "InviteCode_status_createdAt_idx" ON "InviteCode"("status", "createdAt");

ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "MemberUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment"("postId", "createdAt");
CREATE INDEX "Comment_memberId_idx" ON "Comment"("memberId");
CREATE INDEX "Comment_createdAt_idx" ON "Comment"("createdAt");

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "MemberUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "VisitDaily" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VisitDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitDaily_day_path_key" ON "VisitDaily"("day", "path");
CREATE INDEX "VisitDaily_day_idx" ON "VisitDaily"("day");
