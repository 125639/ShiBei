import type { AppCapability, AppMode } from "@/lib/app-mode";
import type { AdminIconName } from "@/components/admin/icons";

/**
 * 后台导航信息架构的唯一数据源：桌面侧栏、移动菜单和顶栏标题推导都从这里
 * 取数（此前只活在 AdminShell.tsx 里，顶栏无法共享）。icon 对应
 * components/admin/icons.tsx 的 AdminIconName。
 */
export type AdminNavItem = {
  href: string;
  zh: string;
  en: string;
  icon: AdminIconName;
  modes?: AppMode[];
  capability?: AppCapability;
};

export type AdminNavGroup = { zh: string; en: string; items: AdminNavItem[] };

// 后台导航按心智模型分组：总览 / 人工内容与治理 / AI 与自动化工具 / 媒体库 / 系统。
export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    zh: "总览",
    en: "Overview",
    items: [
      { href: "/admin", zh: "仪表盘", en: "Dashboard", icon: "dashboard", modes: ["frontend", "backend", "full"] },
      { href: "/admin/stats", zh: "数据看板", en: "Stats", icon: "stats", modes: ["frontend", "backend", "full"] },
      { href: "/admin/jobs", zh: "任务诊断", en: "Jobs", icon: "activity", capability: "local-worker" }
    ]
  },
  {
    zh: "内容",
    en: "Content",
    items: [
      { href: "/admin/posts", zh: "文章与草稿", en: "Posts", icon: "file-text", modes: ["frontend", "backend", "full"] },
      { href: "/admin/comments", zh: "评论管理", en: "Comments", icon: "message", modes: ["frontend", "full"] },
      { href: "/admin/community", zh: "社区治理", en: "Community Moderation", icon: "shield", modes: ["frontend", "full"] },
      { href: "/admin/invites", zh: "邀请码", en: "Invites", icon: "ticket", modes: ["frontend", "full"] }
    ]
  },
  {
    zh: "内容自动化",
    en: "Automation",
    items: [
      { href: "/admin/ai", zh: "AI 管理员", en: "AI Admin", icon: "bot", capability: "local-worker" },
      { href: "/admin/sources", zh: "来源库", en: "Sources", icon: "rss", capability: "local-worker" },
      { href: "/admin/modules", zh: "来源模块", en: "Modules", icon: "layers", capability: "local-worker" },
      { href: "/admin/auto-curation", zh: "自动内容", en: "Auto-Curation", icon: "calendar-clock", capability: "local-worker" }
    ]
  },
  {
    zh: "媒体库",
    en: "Media",
    items: [
      { href: "/admin/videos", zh: "视频库", en: "Videos", icon: "video", modes: ["frontend", "backend", "full"] },
      { href: "/admin/music", zh: "背景音乐", en: "Music", icon: "music", modes: ["frontend", "backend", "full"] }
    ]
  },
  {
    zh: "系统",
    en: "System",
    items: [
      { href: "/admin/settings", zh: "系统设置", en: "Settings", icon: "settings", modes: ["frontend", "backend", "full"] },
      { href: "/admin/sync", zh: "数据同步", en: "Sync", icon: "database", modes: ["frontend", "backend", "full"] },
      { href: "/admin/update", zh: "系统更新", en: "Update", icon: "update", modes: ["frontend", "backend", "full"] }
    ]
  }
];

/** 顶栏标题推导用的扁平列表（含权限过滤前的全集）。 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV_GROUPS.flatMap((group) => group.items);
