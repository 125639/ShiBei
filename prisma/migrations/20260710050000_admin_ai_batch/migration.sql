-- AI 管理员批次:一次计划执行的进度锚点与审计记录

-- CreateTable
CREATE TABLE "AdminAiBatch" (
    "id" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAiBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAiBatch_createdAt_idx" ON "AdminAiBatch"("createdAt");

-- AlterTable
ALTER TABLE "FetchJob" ADD COLUMN "adminAiBatchId" TEXT;

-- CreateIndex
CREATE INDEX "FetchJob_adminAiBatchId_idx" ON "FetchJob"("adminAiBatchId");

-- AddForeignKey
ALTER TABLE "FetchJob" ADD CONSTRAINT "FetchJob_adminAiBatchId_fkey" FOREIGN KEY ("adminAiBatchId") REFERENCES "AdminAiBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
