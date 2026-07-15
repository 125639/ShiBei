-- 账号作品与匿名作品是两条不可隐式迁移的所有权边界。
-- 旧版登录/注册认领只补 ownerId、会留下原 anonId；登录态新建记录则从一开始
-- anonId 就是 NULL。因此双非空记录可确定来自旧自动认领。为避免固化一次潜在的
-- 错误认领，迁移把它归还给原匿名身份：保留不可猜测的 anonId，撤销 ownerId。
UPDATE "CreativeWork"
SET "ownerId" = NULL
WHERE "ownerId" IS NOT NULL AND "anonId" IS NOT NULL;

UPDATE "WritingDoc"
SET "ownerId" = NULL
WHERE "ownerId" IS NOT NULL AND "anonId" IS NOT NULL;

-- 每条私有创作数据必须且只能有一种身份，防止以后代码回归制造双重身份
-- 或无主内容。约束也覆盖 WritingDoc -> CreativeWork 转换后的两端记录。
ALTER TABLE "CreativeWork"
ADD CONSTRAINT "CreativeWork_exactly_one_identity_check"
CHECK (num_nonnulls("ownerId", "anonId") = 1);

ALTER TABLE "WritingDoc"
ADD CONSTRAINT "WritingDoc_exactly_one_identity_check"
CHECK (num_nonnulls("ownerId", "anonId") = 1);
