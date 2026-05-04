import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ModuleRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  sortOrder: number;
  sources: { id: string }[];
  topics: { id: string }[];
};

export default async function ModulesPage() {
  await requireAdmin();
  let modules: ModuleRow[] = [];
  try {
    modules = await (prisma as unknown as {
      sourceModule: { findMany: (args: unknown) => Promise<ModuleRow[]> };
    }).sourceModule.findMany({
      include: {
        sources: { select: { id: true } },
        topics: { select: { id: true } }
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    });
  } catch {
    modules = [];
  }

  return (
    <AdminShell>
      <p className="eyebrow">Modules</p>
      <h1>信息源模块</h1>
      <p className="muted-block" style={{ maxWidth: 760 }}>
        模块用来把信息源按主题归类（如「AI」「娱乐」「财经」）。
        Topic 抓取时只会用关联到对应模块的源，互不干扰。一个源可以同时属于多个模块。
      </p>

      <div className="admin-grid">
        <form className="form-card form-stack" action="/api/admin/modules" method="post">
          <h2>新增模块</h2>
          <div className="field">
            <label htmlFor="name">名称</label>
            <input id="name" name="name" required placeholder="例如：AI / 娱乐 / 财经" />
          </div>
          <div className="field">
            <label htmlFor="description">简介（可选）</label>
            <textarea id="description" name="description" placeholder="对外可见的模块描述" />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="color">主色（卡片高光）</label>
              <input id="color" name="color" type="color" defaultValue="#9f4f2f" />
            </div>
            <div className="field">
              <label htmlFor="sortOrder">排序（小的在前）</label>
              <input id="sortOrder" name="sortOrder" type="number" defaultValue={modules.length} />
            </div>
          </div>
          <button className="button" type="submit">保存模块</button>
        </form>

        <div className="form-card">
          <h2>已有模块（{modules.length}）</h2>
          {modules.length === 0 ? (
            <p className="muted">暂无模块。</p>
          ) : (
            <div className="module-grid">
              {modules.map((module) => (
                <div
                  key={module.id}
                  className="module-card"
                  style={{ ["--module-color" as string]: module.color }}
                >
                  <div className="module-name">{module.name}</div>
                  {module.description && <div className="module-desc">{module.description}</div>}
                  <div className="module-stat">
                    <span>
                      <strong>{module.sources.length}</strong> 信息源
                    </span>
                    <span>
                      <strong>{module.topics.length}</strong> 关联 Topic
                    </span>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <Link className="text-link" href={`/admin/sources?module=${module.slug}`}>
                      管理本模块来源
                    </Link>
                    <form action={`/api/admin/modules/${module.id}/delete`} method="post" style={{ marginLeft: "auto" }}>
                      <button className="button ghost" type="submit">
                        删除
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
