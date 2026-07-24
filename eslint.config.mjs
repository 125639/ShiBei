import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  // .demo-pg 是本地演示用的 Postgres 数据目录（root 属主、不可读），
  // 不忽略的话 `eslint .` 会因 EACCES 直接中断。
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts", ".demo-pg/**"])
];

export default defineConfig(eslintConfig);
