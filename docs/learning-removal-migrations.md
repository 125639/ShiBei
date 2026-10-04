# 学习功能移除后的迁移兼容

三种部署形态都在启动前执行 `prisma migrate deploy`。

保留的 `20261004130000_recognition_model_role` 会修改 `TextbookPage`，但旧教材建表迁移已从工作区删除，且不在 Git 历史中。不能凭空重建同名历史迁移并声称其校验和与已部署版本一致。

新增 `20261004125900_removed_textbook_compatibility`，排在该 OCR 迁移之前，仅在表不存在时创建最小占位表。已有教材表不会被覆盖；后续 `20261004160000_remove_learning` 仍删除学习表及路由字段。旧迁移文件保持不变。

- 全新数据库：兼容占位表 → 旧 OCR 迁移 → 删除学习表。
- 已完成 OCR 迁移的数据库：Prisma 执行尚未记录的兼容迁移（已有表时无操作）→ 删除学习表。
- 已完成删除迁移的数据库：兼容迁移可能被补执行，因此还需后续 final cleanup 再次删除占位表。
- 曾迁移失败的数据库：需管理员先确认实际失败状态，再按 Prisma 的迁移恢复流程处理；本补丁不会自动更改迁移记录。

本补丁不删除原 PDF 文件或 Post 文章记录，不对现有数据库自动执行任何命令。实际部署的删除迁移会删除教材/题目数据，部署前应备份。

## 回归验证

`npm test` 包含迁移顺序检查。真实 SQL 场景测试需显式提供隔离测试库（仅接受本机且库名为 `removal_audit`），不会读取项目 `.env`：

```sh
MIGRATION_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/removal_audit \
  node --test tests/test-learning-removal-migrations.mjs
```

本轮使用临时 PostgreSQL 18 实例完成：

- 空库完整历史迁移链；
- `APP_MODE=full/frontend/backend` 分别在独立空库中执行 `prisma migrate deploy` 和 seed；
- 新库、已有教材表、已执行 OCR 迁移、已执行删除迁移四种 SQL 路径；
- 全量测试（含真实 SQL 场景）。

以上为迁移专项验证；后续 Docker 容器验收结果及其限制见 [容器验收报告](container-verification-20261004.md)。
