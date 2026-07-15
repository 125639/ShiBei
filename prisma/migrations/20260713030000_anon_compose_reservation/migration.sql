-- 匿名 AI 成稿是长任务；在模型调用前持久化短时预留，避免并发请求
-- 同时看到旧计数而突破每 IP 的生成上限。崩溃遗留的预留由应用按 TTL 回收。
ALTER TABLE "CreativeWork"
ADD COLUMN "composeReservedAt" TIMESTAMP(3);

CREATE INDEX "CreativeWork_clientIp_composeReservedAt_idx"
ON "CreativeWork"("clientIp", "composeReservedAt");
