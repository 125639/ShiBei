import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { I18nText } from "@/components/I18nText";
import { ConfirmButton } from "@/components/ConfirmButton";
import { SubmitButton } from "@/components/SubmitButton";
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
      <h1><I18nText zh="信息源模块" en="Source Modules" /></h1>
      <p className="muted-block" style={{ maxWidth: 760 }}>
        <I18nText
          zh="模块用来把信息源按主题归类（如「AI」「娱乐」「财经」）。Topic 抓取时只会用关联到对应模块的源，互不干扰。一个源可以同时属于多个模块。"
          en="Modules group sources by theme (e.g. AI, entertainment, finance). Topic runs only use sources linked to their module. One source can belong to several modules."
        />
      </p>

      <div className="modules-admin">
        <details className="form-card form-stack modules-new" open>
          <summary className="modules-new-summary">
            <h2><I18nText zh="新增模块" en="New Module" /></h2>
          </summary>
          <form action="/api/admin/modules" method="post" className="form-stack modules-new-form">
          <div className="field">
            <label htmlFor="name"><I18nText zh="名称" en="Name" /></label>
            <input id="name" name="name" required placeholder="例如：AI / 娱乐 / 财经" />
          </div>
          <div className="field">
            <label htmlFor="description"><I18nText zh="简介（可选）" en="Description (optional)" /></label>
            <textarea id="description" name="description" placeholder="对外可见的模块描述" />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="color"><I18nText zh="主色（卡片高光）" en="Accent color" /></label>
              <input id="color" name="color" type="color" defaultValue="#9f4f2f" />
            </div>
            <div className="field">
              <label htmlFor="sortOrder"><I18nText zh="排序（小的在前）" en="Sort order (asc)" /></label>
              <input id="sortOrder" name="sortOrder" type="number" defaultValue={modules.length} />
            </div>
          </div>
            <SubmitButton className="button module-submit" pendingLabel={<I18nText zh="保存中…" en="Saving…" />}>
              <I18nText zh="保存模块" en="Save Module" />
            </SubmitButton>
          </form>
        </details>

        <div className="form-card modules-existing">
          <h2><I18nText zh={`已有模块（${modules.length}）`} en={`Modules (${modules.length})`} /></h2>
          {modules.length === 0 ? (
            <p className="muted"><I18nText zh="暂无模块。" en="No modules yet." /></p>
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
                      <strong>{module.sources.length}</strong> <I18nText zh="信息源" en="sources" />
                    </span>
                    <span>
                      <strong>{module.topics.length}</strong> <I18nText zh="关联 Topic" en="topics" />
                    </span>
                  </div>
                  <div className="module-actions">
                    <Link
                      className="module-action"
                      href={`/admin/sources?module=${module.slug}`}
                      aria-label={`管理「${module.name}」来源`}
                      title={`管理「${module.name}」来源`}
                    >
                      <I18nText zh="来源" en="Sources" />
                    </Link>
                    <form className="module-delete-form" action={`/api/admin/modules/${module.id}/delete`} method="post">
                      <ConfirmButton
                        className="module-action module-action-danger"
                        message={`确认删除模块「${module.name}」？它关联着 ${module.sources.length} 个信息源、${module.topics.length} 个 Topic，删除后这些关联会一并解除。`}
                      >
                        <I18nText zh="删除" en="Delete" />
                      </ConfirmButton>
                    </form>
                  </div>
                  <details style={{ marginTop: 10 }}>
                    <summary className="text-link" style={{ cursor: "pointer" }}>
                      <I18nText zh="编辑模块" en="Edit module" />
                    </summary>
                    <form className="form-stack" action={`/api/admin/modules/${module.id}`} method="post" style={{ marginTop: 10 }}>
                      <div className="field-row">
                        <div className="field">
                          <label htmlFor={`module-name-${module.id}`}><I18nText zh="名称" en="Name" /></label>
                          <input id={`module-name-${module.id}`} name="name" required defaultValue={module.name} />
                        </div>
                        <div className="field">
                          <label htmlFor={`module-slug-${module.id}`}>Slug</label>
                          <input id={`module-slug-${module.id}`} name="slug" required pattern="[a-z0-9-]+" defaultValue={module.slug} />
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor={`module-description-${module.id}`}><I18nText zh="简介" en="Description" /></label>
                        <textarea id={`module-description-${module.id}`} name="description" defaultValue={module.description || ""} />
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label htmlFor={`module-color-${module.id}`}><I18nText zh="主色" en="Accent" /></label>
                          <input id={`module-color-${module.id}`} name="color" type="color" defaultValue={module.color} />
                        </div>
                        <div className="field">
                          <label htmlFor={`module-order-${module.id}`}><I18nText zh="排序" en="Order" /></label>
                          <input id={`module-order-${module.id}`} name="sortOrder" type="number" defaultValue={module.sortOrder} />
                        </div>
                      </div>
                      <SubmitButton pendingLabel={<I18nText zh="保存中…" en="Saving…" />}>
                        <I18nText zh="保存模块修改" en="Save module" />
                      </SubmitButton>
                    </form>
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
