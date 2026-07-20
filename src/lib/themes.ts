export type ThemeKey =
  | "apple"
  | "minimal"
  | "dark"
  | "sepia"
  | "ocean"
  | "forest"
  | "sunset"
  | "midnight";

export type FontKey =
  | "serif-cjk"
  | "sans-cjk"
  | "kaiti"
  | "fangsong"
  | "system"
  | "mono";

export type DensityKey = "compact" | "normal" | "cozy";

export type CursorStyleKey = "classic" | "fairydust" | "rainbow" | "bubbles" | "fireflies";

/** 界面风格：整体设计语言（排版/装饰/质感），与色彩主题（data-theme）正交组合。 */
export type UiStyleKey = "classic" | "glass" | "editorial" | "paper" | "firefly" | "meow" | "cyber" | "dynamic";

export const UI_STYLES: Array<{
  key: UiStyleKey;
  zh: string;
  en: string;
  zhDesc: string;
  enDesc: string;
}> = [
  {
    key: "classic",
    zh: "经典风格 (Classic)",
    en: "Classic",
    zhDesc: "温和、沉静的默认体验（默认）",
    enDesc: "Soft & calm default experience"
  },
  {
    key: "glass",
    zh: "渐变玻璃 (Glass)",
    en: "Glass",
    zhDesc: "柔和渐变光斑、毛玻璃卡片与光晕点缀",
    enDesc: "Soft gradient orbs, frosted cards & glow accents"
  },
  {
    key: "editorial",
    zh: "杂志编辑 (Editorial)",
    en: "Editorial",
    zhDesc: "衬线大标题、编号条目与细分割线，刊物气质",
    enDesc: "Serif headlines, numbered entries & fine rules"
  },
  {
    key: "paper",
    zh: "温暖纸质 (Paper)",
    en: "Paper",
    zhDesc: "纸感底色、衬线正文与柔和投影，阅读优先",
    enDesc: "Paper texture, serif body & soft shadows"
  },
  {
    key: "firefly",
    zh: "流萤博客 (Firefly)",
    en: "Firefly",
    zhDesc: "Material 3 卡片、壁纸感背景、双侧栏小组件与网格文章",
    enDesc: "Material 3 cards, wallpaper backdrop, side widgets & post grids"
  },
  {
    key: "meow",
    zh: "魔法喵喵 (Meow)",
    en: "Meow",
    zhDesc: "奶油纸底、墨线描边、硬投影贴纸与糖果撞色的卡通杂志",
    enDesc: "Cream paper, chunky ink outlines, sticker shadows & candy pops"
  },
  {
    key: "cyber",
    zh: "科技纪元 (Cyberpunk)",
    en: "Cyberpunk",
    zhDesc: "暗网格、高光边缘与动态反馈",
    enDesc: "Dark grids, neon edges & feedback"
  },
  {
    key: "dynamic",
    zh: "动态流光 (Dynamic)",
    en: "Dynamic",
    zhDesc: "毛玻璃、灵动动画与流光背景",
    enDesc: "Glassmorphism & fluid animations"
  }
];

export const UI_STYLE_KEYS = UI_STYLES.map((style) => style.key);

export function isUiStyleKey(value: string | null | undefined): value is UiStyleKey {
  return UI_STYLES.some((style) => style.key === value);
}

export const THEMES: Array<{
  key: ThemeKey;
  label: string;
  desc: string;
  swatch: [string, string, string, string];
}> = [
  {
    key: "apple",
    label: "Apple",
    desc: "纯白底色 + Apple 蓝点缀，大字号留白宽阔（默认）",
    swatch: ["#ffffff", "#fbfbfd", "#0071e3", "#1d1d1f"]
  },
  {
    key: "minimal",
    label: "简约",
    desc: "精密留白、冷静灰阶与产品式蓝色焦点",
    swatch: ["#f5f5f7", "#ffffff", "#0071e3", "#1d1d1f"]
  },
  {
    key: "dark",
    label: "暗夜",
    desc: "黑色背景，温暖橙色点缀，护眼省电",
    swatch: ["#14110e", "#1d1916", "#e08a4a", "#f5ecdf"]
  },
  {
    key: "sepia",
    label: "羊皮卷",
    desc: "复古泛黄纸质，长时间阅读舒适",
    swatch: ["#ede0c4", "#e2d2b1", "#864c1e", "#3d2f1c"]
  },
  {
    key: "ocean",
    label: "海蓝",
    desc: "冷色基调，蓝绿点缀，干净清爽",
    swatch: ["#eaf2f5", "#d6e6ed", "#2c6e8e", "#0f2a3a"]
  },
  {
    key: "forest",
    label: "森林",
    desc: "森绿基调，自然温和",
    swatch: ["#e9f0e3", "#d6e3cb", "#3f6b3a", "#1f2a18"]
  },
  {
    key: "sunset",
    label: "晚霞",
    desc: "粉橙基调，温暖明亮",
    swatch: ["#fbeae0", "#f6d7c4", "#c95237", "#3a1f1a"]
  },
  {
    key: "midnight",
    label: "午夜",
    desc: "深蓝夜空，星辰般的高对比配色",
    swatch: ["#0d1320", "#161e30", "#6da4d6", "#e6ebf5"]
  }
];

export const FONTS: Array<{
  key: FontKey;
  label: string;
  desc: string;
  preview: string;
  family: string;
}> = [
  {
    key: "serif-cjk",
    label: "中文衬线",
    desc: "Source Han / Noto Serif，新闻阅读首选（默认）",
    preview: "内容文章",
    family: "ui-serif, 'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', 'Noto Sans SC Variable', Georgia, serif"
  },
  {
    key: "sans-cjk",
    label: "中文无衬线",
    desc: "PingFang / Noto Sans，更清爽的现代感",
    preview: "内容文章",
    family: "ui-sans-serif, 'Noto Sans SC Variable', 'PingFang SC', 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif"
  },
  {
    key: "kaiti",
    label: "霞鹜文楷",
    desc: "LXGW WenKai 风格，手写楷体韵味",
    preview: "内容文章",
    family: "'LXGW WenKai', 'KaiTi', 'STKaiti', 'Source Han Serif SC', 'Noto Sans SC Variable', serif"
  },
  {
    key: "fangsong",
    label: "仿宋",
    desc: "正式典雅，适合公文与长文",
    preview: "内容文章",
    family: "'FangSong', 'STFangsong', 'Source Han Serif SC', 'Noto Sans SC Variable', serif"
  },
  {
    key: "system",
    label: "系统默认",
    desc: "使用操作系统默认字体，加载最快",
    preview: "内容文章",
    family: "system-ui, -apple-system, 'Noto Sans SC Variable', 'PingFang SC', 'Microsoft YaHei', sans-serif"
  },
  {
    key: "mono",
    label: "等宽",
    desc: "JetBrains Mono / 等宽中文，技术风格",
    preview: "内容文章",
    family: "ui-monospace, 'JetBrains Mono', 'Liberation Mono', 'Noto Sans SC Variable', monospace"
  }
];

export const DENSITIES: Array<{ key: DensityKey; label: string; desc: string }> = [
  { key: "compact", label: "紧凑", desc: "信息密度更高" },
  { key: "normal", label: "标准", desc: "默认间距" },
  { key: "cozy", label: "舒适", desc: "更宽松，便于长时间阅读" }
];

// 除 classic 外均为拖尾粒子特效(参考 tholman/cursor-effects),保留系统指针
export const CURSOR_STYLES: Array<{ key: CursorStyleKey; label: string; desc: string }> = [
  { key: "classic", label: "经典圆环", desc: "圆点跟随，圆环缓动" },
  { key: "fairydust", label: "仙尘拖尾", desc: "移动时洒落缤纷星屑" },
  { key: "rainbow", label: "彩虹丝带", desc: "彩虹轨迹跟随光标" },
  { key: "bubbles", label: "气泡上浮", desc: "光标经过冒出小气泡" },
  { key: "fireflies", label: "流萤微光", desc: "暖色光点缓缓飘散" }
];

export const DEFAULT_THEME: ThemeKey = "apple";
export const DEFAULT_FONT: FontKey = "sans-cjk";
export const DEFAULT_DENSITY: DensityKey = "normal";
export const DEFAULT_CURSOR_STYLE: CursorStyleKey = "classic";
export const DEFAULT_TOC_ACCENT = "#6ea8ff";

export function isThemeKey(value: string | null | undefined): value is ThemeKey {
  return THEMES.some((t) => t.key === value);
}

export function isFontKey(value: string | null | undefined): value is FontKey {
  return FONTS.some((f) => f.key === value);
}

export function isDensityKey(value: string | null | undefined): value is DensityKey {
  return DENSITIES.some((d) => d.key === value);
}

export function isCursorStyleKey(value: string | null | undefined): value is CursorStyleKey {
  return CURSOR_STYLES.some((style) => style.key === value);
}

export const PREF_KEYS = {
  theme: "shibei.theme",
  font: "shibei.font",
  density: "shibei.density",
  language: "shibei.language",
  ui: "shibei.ui",
  customCursor: "shibei.customCursor",
  cursorStyle: "shibei.cursorStyle",
  tocAccent: "shibei.tocAccent",
  musicEnabled: "shibei.music.enabled",
  musicTrackId: "shibei.music.trackId",
  musicVolume: "shibei.music.volume"
} as const;
