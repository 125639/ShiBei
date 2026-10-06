# 手动更新被 `M scripts/init.sh` 阻止

## 原因与修复

Git 中 `scripts/init.sh` 的权限是 `100644`。旧 `scripts/bootstrap.sh` 会先 `chmod +x scripts/init.sh`，再 `exec bash scripts/init.sh`。`bash` 调用不需要执行位，额外的 chmod 却让新安装的仓库立刻产生一个纯权限修改，随后被更新器的工作区保护拦下。

修复包含：

- 引导脚本直接通过 `bash` 调用安装脚本，不再改权限。
- 更新器确认目标分支后，在脏工作区检查前，仅处理 `scripts/init.sh` 的历史、未暂存执行位变化。
- 必须同时满足 HEAD 和暂存区记录均为 `100644`、二者 blob 相同、工作文件原始字节对应同一 Git blob、路径为普通文件且确实存在未暂存修改，才备份并恢复执行位。
- 备份保存在 Git 管理目录的 `shibei-updater-backups/init-mode-*`，含原文件及原权限元数据，不会制造新的未跟踪文件。
- 恢复执行位后重新检查完整工作区。真实内容修改、暂存修改、其他权限修改、未跟踪文件、本地提交、分支不一致等仍拒绝更新；不会 stash、强制 reset、覆盖文件或关闭 Git 的权限检查。

## 已部署旧版的临时处理

旧 updater 进程不会自动加载刚下载的自身代码，第一次可能仍需管理员处理一次旧权限。

在**报错实例所挂载的实际仓库目录**执行：

```bash
git diff --summary -- scripts/init.sh
git diff --numstat -- scripts/init.sh
git diff --cached -- scripts/init.sh
```

只有第一条显示 `mode change 100644 => 100755`，且后两条均无输出时，才执行：

```bash
chmod a-x scripts/init.sh
git status --short
```

这不修改脚本内容。如果仍有其他变更，先备份并处理真实改动，不能绕过保护。工作区恢复干净后，再点网页更新。

已经取得新脚本且宿主有 Node.js 时，也可使用带自动校验与备份的入口：

```bash
node scripts/updater/worktree.mjs
```

updater 镜像需要带上新依赖 `worktree.mjs`。要让现有 updater 使用新逻辑，在原 compose 项目和对应模式的 compose 文件下重建 **updater 服务本身**；例如完整版默认文件：

```bash
docker compose up -d --no-deps --build updater
```

分离前端/后端部署须使用原来的 `-p` 项目名与 `-f` 文件，不能在任意目录启动第二套项目。

## 回归验证

`node --test tests/test-updater-worktree.mjs` 使用临时 Git 仓库和真实 updater HTTP 服务验证：

- 新克隆以及重复运行 bootstrap 后仍是干净仓库。
- 历史纯执行位变化得到备份，文件内容和暂存区不变。
- 修复后完成真实 Git fetch/快进，并进入既有 compose 项目的 pull/up 流程。
- 真实代码修改、暂存修改、未跟踪文件、本地提交、错误分支、符号链接等仍受保护。
- 同时存在纯权限遗留和管理员 compose 修改时，后者仍拦住更新。

测试中的 Docker 命令使用隔离桩，不会实际拉镜像或重启生产容器；不能将该测试表述为生产更新已完成。
