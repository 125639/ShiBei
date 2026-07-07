-- 共创工作室：读者访谈式创作（会员、题材评分标尺、创作作品）。

-- CreateEnum
CREATE TYPE "CreationMode" AS ENUM ('VOICE_FIRST', 'AI_FIRST');

-- CreateEnum
CREATE TYPE "CreationDepth" AS ENUM ('SHORT', 'FULL');

-- CreateEnum
CREATE TYPE "CreationStatus" AS ENUM ('INTERVIEWING', 'DRAFT', 'SHARED');

-- CreateTable
CREATE TABLE "MemberUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreationGenre" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "dimensions" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 70,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreationGenre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeWork" (
    "id" TEXT NOT NULL,
    "slug" TEXT,
    "ownerId" TEXT,
    "anonId" TEXT,
    "clientIp" TEXT,
    "genreId" TEXT NOT NULL,
    "mode" "CreationMode" NOT NULL,
    "depth" "CreationDepth" NOT NULL,
    "status" "CreationStatus" NOT NULL DEFAULT 'INTERVIEWING',
    "topic" TEXT NOT NULL,
    "interview" TEXT NOT NULL DEFAULT '[]',
    "pendingQuestion" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "draftGeneratedAt" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "scoreDetail" TEXT,
    "scoredAt" TIMESTAMP(3),
    "scoredHash" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeWork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberUser_email_key" ON "MemberUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CreationGenre_slug_key" ON "CreationGenre"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeWork_slug_key" ON "CreativeWork"("slug");

-- CreateIndex
CREATE INDEX "CreativeWork_status_publishedAt_idx" ON "CreativeWork"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "CreativeWork_ownerId_updatedAt_idx" ON "CreativeWork"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "CreativeWork_anonId_updatedAt_idx" ON "CreativeWork"("anonId", "updatedAt");

-- CreateIndex
CREATE INDEX "CreativeWork_clientIp_draftGeneratedAt_idx" ON "CreativeWork"("clientIp", "draftGeneratedAt");

-- CreateIndex
CREATE INDEX "CreativeWork_genreId_idx" ON "CreativeWork"("genreId");

-- AddForeignKey
ALTER TABLE "CreativeWork" ADD CONSTRAINT "CreativeWork_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MemberUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeWork" ADD CONSTRAINT "CreativeWork_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "CreationGenre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
