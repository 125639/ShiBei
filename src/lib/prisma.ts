import { PrismaClient } from "@prisma/client";
import { stripNulBytes } from "./strip-nul";

/**
 * 所有模型操作的 args 统一过 stripNulBytes：Postgres 拒收 NUL(0x00)，而外部
 * 抓取内容随时可能带进来（错误码 22021）。挂在客户端扩展上意味着任何现在/未来
 * 的写入路径都自动受保护，不必在每个 upsert 调用点手工包一层（曾经就是漏包才
 * 让整条抓取任务崩掉的）。干净输入零分配（见 strip-nul.ts），对查询性能无感。
 */
function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  }).$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          return query(stripNulBytes(args));
        }
      }
    }
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
