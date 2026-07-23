import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { requireAdmin } from "@/lib/auth";
import { getAppMode } from "@/lib/app-mode";
import { getBuildInfo } from "@/lib/build-info";
import { UpdateClient } from "./UpdateClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "系统更新" };

// 系统更新页：左上角弹窗被叉掉后，这里是常驻的更新入口。
// 三种部署形态（full / backend / frontend）都可用；
// 实际的拉代码/重建由各形态 compose 里的 updater 伴车容器执行。
export default async function UpdateAdminPage() {
  await requireAdmin();
  const mode = getAppMode();
  const build = getBuildInfo();

  const composeFile =
    mode === "backend"
      ? "docker-compose.backend.yml"
      : mode === "frontend"
        ? "docker-compose.frontend.yml"
        : "docker-compose.yml";

  return (
    <AdminShell>
      <div className="admin-page-header">
        <div>
          <p className="eyebrow">Update</p>
          <h1>
            <I18nText zh="系统更新" en="System Update" />
          </h1>
        </div>
      </div>
      <p className="muted-block" style={{ maxWidth: 720 }}>
        <I18nText
          zh="检查 GitHub 仓库的新版本，并在网页上一键完成「拉取代码 → 重建镜像 → 滚动重启」，无需登录服务器终端。更新期间站点会短暂中断几十秒；数据库与上传文件不受影响。"
          en="Check GitHub for new versions and run pull → rebuild → rolling restart right from this page, no SSH needed. Expect a brief downtime; the database and uploads are untouched."
        />
      </p>
      <UpdateClient mode={mode} composeFile={composeFile} runningCommit={build.commit} builtAt={build.builtAt} />
    </AdminShell>
  );
}
