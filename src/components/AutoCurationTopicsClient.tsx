"use client";

import { useEffect, useMemo, useState } from "react";
import { describeAlarmCron } from "@/lib/alarm-schedule";
import { ConfirmButton } from "@/components/ConfirmButton";
import { I18nText } from "@/components/I18nText";
import { CronInput } from "@/components/CronInput";

type StyleOption = {
  id: string;
  name: string;
  tone: string;
};

export type AutoTopicItem = {
  id: string;
  name: string;
  slug: string;
  keywords: string;
  scope: string;
  compileKind: string;
  depth: string;
  articleCount: number;
  styleId: string | null;
  styleName: string | null;
  isEnabled: boolean;
  useExa: boolean;
  scheduleCron: string;
  lastRunLabel: string;
  nextRunLabel: string;
};

type Props = {
  topics: AutoTopicItem[];
  styles: StyleOption[];
};

const COMPILE_KIND_LABELS: Record<string, string> = {
  SINGLE_ARTICLE: "单篇文章 / Single",
  DAILY_DIGEST: "每日合集 / Daily digest",
  WEEKLY_ROUNDUP: "周报合集 / Weekly"
};

const SCOPE_LABELS: Record<string, string> = {
  all: "国内+国外 / All",
  domestic: "国内 / Domestic",
  international: "国外 / Intl"
};

const DEPTH_LABELS: Record<string, string> = {
  standard: "标准 / Standard",
  long: "长文章 / Long",
  deep: "深度长文 / In-depth"
};

function previewKeywords(value: string, limit = 4) {
  return value
    .split(/\n|,|，/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join(" / ");
}

export function AutoCurationTopicsClient({ topics, styles }: Props) {
  const [selectedId, setSelectedId] = useState(topics[0]?.id ?? null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedId) ?? topics[0] ?? null,
    [selectedId, topics]
  );
  const editingTopic = editingId && editingId !== "new"
    ? topics.find((topic) => topic.id === editingId) ?? null
    : null;
  const checkedList = Array.from(checkedIds);
  const allChecked = topics.length > 0 && checkedIds.size === topics.length;

  function toggleChecked(id: string) {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCheckAll() {
    setCheckedIds((current) => (current.size === topics.length ? new Set() : new Set(topics.map((topic) => topic.id))));
  }

  useEffect(() => {
    if (!editingId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditingId(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editingId]);

  return (
    <section className="admin-panel auto-topic-workspace">
      <div className="auto-topic-toolbar">
        <div>
          <h2><I18nText zh="已配置主题" en="Configured Topics" /></h2>
          <p className="muted"><I18nText zh="列表只展示关键状态；完整设置在弹窗中查看和修改。" en="The list shows key status only; full settings live in the dialog." /></p>
        </div>
        <button className="button" type="button" onClick={() => setEditingId("new")}>
          <I18nText zh="新建主题" en="New Topic" />
        </button>
      </div>

      {topics.length === 0 ? (
        <div className="auto-empty-state">
          <p className="muted"><I18nText zh={<>还没有自动主题。可以新建一个主题，或在服务端运行 <code>npm run db:seed</code> 导入示例主题。</>} en={<>No topics yet. Create one, or run <code>npm run db:seed</code> on the server to import samples.</>} /></p>
        </div>
      ) : (
        <div className="auto-topic-board">
          <div className="auto-topic-list-column">
            <div className="auto-topic-bulkbar">
              <label className="auto-topic-checkall">
                <span className="round-checkbox">
                  <input type="checkbox" checked={allChecked} onChange={toggleCheckAll} aria-label="全选主题" />
                  <span className="round-checkbox-dot" aria-hidden="true" />
                </span>
                <I18nText zh="全选" en="Select all" />
              </label>
              {checkedList.length > 0 ? (
                <>
                  <span className="muted"><I18nText zh={`已选择 ${checkedList.length} 个主题`} en={`Selected ${checkedList.length} topics`} /></span>
                  <form action="/api/admin/content-topics/bulk/enable" method="post" className="auto-bulk-form">
                    {checkedList.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
                    <button className="button secondary" type="submit"><I18nText zh="批量启用" en="Enable" /></button>
                  </form>
                  <form action="/api/admin/content-topics/bulk/disable" method="post" className="auto-bulk-form">
                    {checkedList.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
                    <button className="button secondary" type="submit"><I18nText zh="批量停用" en="Disable" /></button>
                  </form>
                  <form action="/api/admin/content-topics/bulk/run" method="post" className="auto-bulk-form">
                    {checkedList.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
                    <button className="button secondary" type="submit"><I18nText zh="批量试运行" en="Run now" /></button>
                  </form>
                  <form action="/api/admin/content-topics/bulk/delete" method="post" className="auto-bulk-form">
                    {checkedList.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
                    <ConfirmButton message={`确定删除选中的 ${checkedList.length} 个主题?此操作无法撤销。`}>
                      <I18nText zh="批量删除" en="Delete" />
                    </ConfirmButton>
                  </form>
                  <button className="button secondary" type="button" onClick={() => setCheckedIds(new Set())}>
                    <I18nText zh="取消选择" en="Clear selection" />
                  </button>
                </>
              ) : null}
            </div>

            <div className="auto-topic-list" role="list">
              {topics.map((topic) => {
                const selected = topic.id === selectedTopic?.id;
                return (
                  <div key={topic.id} className={`auto-topic-card${selected ? " is-selected" : ""}`}>
                    <label className="auto-topic-checkbox">
                      <span className="round-checkbox">
                        <input
                          type="checkbox"
                          checked={checkedIds.has(topic.id)}
                          onChange={() => {
                            toggleChecked(topic.id);
                            setSelectedId(topic.id);
                          }}
                          onDoubleClick={() => {
                            setSelectedId(topic.id);
                            setEditingId(topic.id);
                          }}
                          title="单击勾选，双击编辑"
                          aria-label={`选择主题 ${topic.name}`}
                        />
                        <span className="round-checkbox-dot" aria-hidden="true" />
                      </span>
                    </label>
                    <button
                      type="button"
                      className="auto-topic-main-button"
                      aria-pressed={selected}
                      title="单击选择，双击设置"
                      onClick={() => setSelectedId(topic.id)}
                      onDoubleClick={() => {
                        setSelectedId(topic.id);
                        setEditingId(topic.id);
                      }}
                    >
                      <span className="auto-topic-main">
                        <strong>{topic.name}</strong>
                        <small>{describeAlarmCron(topic.scheduleCron)} · {previewKeywords(topic.keywords) || "—"}</small>
                      </span>
                      <span className="auto-topic-status">
                        <span className="tag">{topic.isEnabled ? <I18nText zh="启用" en="On" /> : <I18nText zh="停用" en="Off" />}</span>
                        <span className="auto-topic-gear" aria-hidden="true">⚙</span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="auto-topic-inspector" aria-live="polite">
            {selectedTopic ? (
              <>
                <div className="meta-row">
                  <span className="tag">{COMPILE_KIND_LABELS[selectedTopic.compileKind] || selectedTopic.compileKind}</span>
                  <span className="tag">{SCOPE_LABELS[selectedTopic.scope] || selectedTopic.scope}</span>
                  <span className="tag">{selectedTopic.styleName || <I18nText zh="默认风格" en="Default style" />}</span>
                </div>
                <h3>{selectedTopic.name}</h3>
                <dl className="auto-topic-facts">
                  <div>
                    <dt><I18nText zh="定时" en="Schedule" /></dt>
                    <dd>{describeAlarmCron(selectedTopic.scheduleCron)}</dd>
                  </div>
                  <div>
                    <dt><I18nText zh="关键词" en="Keywords" /></dt>
                    <dd>{previewKeywords(selectedTopic.keywords, 8) || "—"}</dd>
                  </div>
                  <div>
                    <dt><I18nText zh="长度 / 篇数" en="Length / count" /></dt>
                    <dd>{DEPTH_LABELS[selectedTopic.depth] || selectedTopic.depth} · {selectedTopic.articleCount}</dd>
                  </div>
                  <div>
                    <dt><I18nText zh="上次运行" en="Last run" /></dt>
                    <dd>{selectedTopic.lastRunLabel}</dd>
                  </div>
                  <div>
                    <dt><I18nText zh="下次运行" en="Next run" /></dt>
                    <dd>{selectedTopic.nextRunLabel}</dd>
                  </div>
                </dl>
                <div className="row-actions">
                  <button className="button secondary" type="button" onClick={() => setEditingId(selectedTopic.id)}>
                    <I18nText zh="设置" en="Settings" />
                  </button>
                  <form action={`/api/admin/content-topics/${selectedTopic.id}/run`} method="post">
                    <button className="button secondary" type="submit"><I18nText zh="立即试运行" en="Run now" /></button>
                  </form>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      )}

      {editingId ? (
        <TopicSettingsDialog
          topic={editingId === "new" ? null : editingTopic}
          styles={styles}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </section>
  );
}

function TopicSettingsDialog({
  topic,
  styles,
  onClose
}: {
  topic: AutoTopicItem | null;
  styles: StyleOption[];
  onClose: () => void;
}) {
  const isNew = !topic;
  const formAction = isNew ? "/api/admin/content-topics" : `/api/admin/content-topics/${topic.id}`;

  return (
    <div className="auto-topic-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="auto-topic-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-topic-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="auto-topic-dialog-header">
          <div>
            <p className="eyebrow">{isNew ? "New automation topic" : "Topic settings"}</p>
            <h2 id="auto-topic-dialog-title">{isNew ? <I18nText zh="新建自动主题" en="New Auto Topic" /> : topic.name}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭设置" title="关闭">
            X
          </button>
        </div>

        <form className="form-stack" action={formAction} method="post">
          <div className="field-row">
            <div className="field">
              <label htmlFor="auto-topic-name"><I18nText zh="主题名称" en="Topic name" /></label>
              <input id="auto-topic-name" name="name" required defaultValue={topic?.name || ""} placeholder="例如：财经周报" />
            </div>
            <div className="field">
              <label htmlFor="auto-topic-slug">Slug</label>
              {isNew ? (
                <input id="auto-topic-slug" name="slug" required pattern="[a-z0-9-]+" placeholder="finance-weekly" />
              ) : (
                <input id="auto-topic-slug" value={topic.slug} readOnly />
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor="auto-topic-keywords"><I18nText zh="关键词" en="Keywords" /></label>
            <textarea
              id="auto-topic-keywords"
              name="keywords"
              rows={4}
              required
              defaultValue={topic?.keywords || ""}
              placeholder={"人工智能\n芯片\n新能源"}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="auto-topic-scope"><I18nText zh="资料范围" en="Source scope" /></label>
              <select id="auto-topic-scope" name="scope" defaultValue={topic?.scope || "all"}>
                <option value="all">国内 + 国外 / All</option>
                <option value="domestic">仅国内 / Domestic</option>
                <option value="international">仅国外 / International</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="auto-topic-kind"><I18nText zh="产出形式" en="Output format" /></label>
              <select id="auto-topic-kind" name="compileKind" defaultValue={topic?.compileKind || "SINGLE_ARTICLE"}>
                <option value="SINGLE_ARTICLE">单篇文章 / Single article</option>
                <option value="DAILY_DIGEST">每日合集 / Daily digest</option>
                <option value="WEEKLY_ROUNDUP">周报合集 / Weekly roundup</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="auto-topic-depth"><I18nText zh="单篇长度" en="Article length" /></label>
              <select id="auto-topic-depth" name="depth" defaultValue={topic?.depth || "long"}>
                <option value="standard">标准（≥1100 字）/ Standard</option>
                <option value="long">长文（≥1900 字）/ Long</option>
                <option value="deep">深度（≥3000 字）/ In-depth</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="auto-topic-count"><I18nText zh="篇数" en="Count" /></label>
              <input id="auto-topic-count" name="articleCount" type="number" min="1" max="5" defaultValue={topic?.articleCount || 1} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="auto-topic-style"><I18nText zh="内容风格" en="Content style" /></label>
            <select id="auto-topic-style" name="styleId" defaultValue={topic?.styleId || ""}>
              <option value="">使用默认风格 / Default style</option>
              {styles.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name}（{style.tone}）
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="auto-topic-schedule"><I18nText zh="定时" en="Schedule" /></label>
            <CronInput id="auto-topic-schedule" required defaultValue={topic?.scheduleCron || "0 9 * * *"} />
          </div>

          <div className="settings-check-grid">
            <label className="settings-check-item">
              <input type="checkbox" name="isEnabled" value="true" defaultChecked={topic?.isEnabled ?? true} />
              <I18nText zh="启用此主题" en="Enable this topic" />
            </label>
            <label className="settings-check-item">
              <input type="checkbox" name="useExa" value="true" defaultChecked={topic?.useExa ?? true} />
              <I18nText zh="使用 Exa 网页搜索" en="Use Exa web search" />
            </label>
          </div>

          <div className="auto-topic-dialog-actions">
            <button className="button" type="submit"><I18nText zh="保存设置" en="Save" /></button>
            {!isNew && topic ? (
              <>
                <button className="button secondary" type="submit" formAction={`/api/admin/content-topics/${topic.id}/run`}>
                  <I18nText zh="立即试运行" en="Run now" />
                </button>
                <span className="auto-dialog-spacer" />
                <ConfirmButton
                  message={`确定删除主题「${topic.name}」?此操作无法撤销。`}
                  formAction={`/api/admin/content-topics/${topic.id}/delete`}
                >
                  <I18nText zh="删除主题" en="Delete topic" />
                </ConfirmButton>
              </>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
