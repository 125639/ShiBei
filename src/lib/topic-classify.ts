/**
 * 文章 → 内容主题（分类）的自动归类器。
 *
 * 背景：只有自动内容生产（keyword research / digest）产出的文章会带上
 * ContentTopic，来源抓取（web / rss）的文章从不归类——前台「按主题分栏」
 * 因此形同虚设，绝大多数卡片没有分类角标。
 *
 * 纯词库打分，不调模型：标题命中权重 3、摘要 2、正文摘录 1。词库 =
 * 内置分类词典（按 slug 匹配标准新闻分类）∪ 管理员在主题上配置的 keywords
 * ∪ 主题名本身。词库都没命中时，退回「来源所属模块 → 分类」的映射提示。
 *
 * 被 worker（新文章入库时）与 scripts/backfill-post-topics.ts（存量回填）共用。
 */

export type ClassifiableTopic = {
  id: string;
  slug: string;
  name: string;
  keywords: string;
};

export type ClassifyInput = {
  title: string;
  summary?: string | null;
  content?: string | null;
  /** 来源所属模块的 slug 列表（可选，作为词库未命中时的回退信号）。 */
  moduleSlugs?: string[];
};

/** 命中总分低于该值视为与任何分类都不相关（防止一次偶然命中就乱挂）。 */
const MIN_SCORE = 3;
/** 正文只取前一段参与打分：足够定主题，又避免长文尾部引用来源列表干扰。 */
const CONTENT_EXCERPT_CHARS = 1600;

// 内置分类词典：键是常见主题 slug（seed 与用户库中实际存在的一套），
// 值是该类新闻的高频特征词。DB 里管理员配置的 keywords 会与之合并。
const BUILTIN_LEXICON: Record<string, string[]> = {
  politics: [
    "时政", "政府", "国务院", "外交", "外交部", "人大", "政协", "中央", "总书记", "主席",
    "总理", "部长", "政策", "法规", "立法", "选举", "总统", "首相", "议会", "国会",
    "白宫", "监管", "党", "官员", "会谈", "声明", "制裁", "谈判", "条约", "两会"
  ],
  economy: [
    "经济", "宏观", "金融", "股市", "A股", "港股", "美股", "央行", "利率", "通胀",
    "GDP", "财报", "营收", "利润", "投资", "融资", "上市", "IPO", "汇率", "债券",
    "房地产", "楼市", "消费", "贸易", "关税", "产业", "制造业", "供应链", "市值", "基金",
    "银行", "保险", "财政", "税", "企业", "并购", "美联储"
  ],
  society: [
    "社会", "民生", "事故", "公共安全", "社区", "警方", "法院", "判决", "案件", "犯罪",
    "医院", "医疗", "疫情", "灾害", "地震", "洪水", "台风", "火灾", "救援", "就业",
    "养老", "住房", "物价", "食品安全", "交通事故", "舆论", "慈善", "人口"
  ],
  "culture-edu": [
    "文化", "教育", "高考", "考研", "大学", "学校", "教师", "学生", "课程", "教材",
    "出版", "图书", "文学", "作家", "博物馆", "文化遗产", "非遗", "考古", "历史",
    "艺术", "展览", "文艺", "学术", "科普", "论文", "研究生", "留学"
  ],
  sports: [
    "体育", "足球", "篮球", "奥运", "亚运", "世界杯", "联赛", "球队", "球员", "运动员",
    "教练", "冠军", "夺冠", "比赛", "赛事", "网球", "乒乓球", "羽毛球", "游泳", "田径",
    "电竞", "NBA", "CBA", "英超", "欧冠", "转会", "积分榜"
  ],
  technology: [
    "科技", "技术", "芯片", "半导体", "互联网", "软件", "硬件", "手机", "苹果", "华为",
    "谷歌", "微软", "特斯拉", "新能源", "电动车", "电池", "航天", "火箭", "卫星", "量子",
    "机器人", "算法", "开源", "编程", "云计算", "数据中心", "网络安全", "5G", "操作系统", "浏览器"
  ],
  entertainment: [
    "娱乐", "电影", "电视剧", "综艺", "音乐", "演唱会", "明星", "演员", "导演", "票房",
    "首映", "颁奖", "奥斯卡", "金像奖", "时尚", "偶像", "粉丝", "剧集", "动画", "游戏"
  ],
  international: [
    "国际", "全球", "联合国", "峰会", "北约", "欧盟", "美国", "俄罗斯", "乌克兰", "中东",
    "以色列", "伊朗", "日本", "韩国", "朝鲜", "印度", "欧洲", "非洲", "拉美", "东南亚",
    "国际组织", "外媒", "战争", "冲突", "停火", "难民", "大使馆"
  ],
  domestic: [
    "全国", "各地", "省委", "省政府", "市政", "地方", "城市", "乡村", "振兴", "基建",
    "铁路", "高铁", "机场", "开工", "示范区", "自贸区"
  ],
  local: ["本地", "社区", "街道", "市民", "城管", "公交", "地铁"],
  ai: [
    "人工智能", "AI", "大模型", "GPT", "ChatGPT", "OpenAI", "Anthropic", "Claude", "Gemini",
    "深度学习", "机器学习", "神经网络", "生成式", "智能体", "Agent", "推理模型", "训练",
    "算力", "英伟达", "Nvidia", "Transformer", "LLM", "AIGC", "自动驾驶"
  ]
};

// 来源模块 slug → 主题 slug 的回退映射（模块与主题只有部分语义重合，
// 只映射明确的几对；综合资讯之类不映射）。
const MODULE_TOPIC_HINTS: Record<string, string> = {
  finance: "economy",
  tech: "technology",
  international: "international",
  culture: "culture-edu",
  academic: "culture-edu",
  "science-popular": "technology",
  developers: "technology",
  design: "technology",
  "indie-writing": "culture-edu"
};

function splitKeywords(raw: string): string[] {
  return raw
    .split(/[\n,，、;；\s]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 || /^[A-Za-z0-9]{2,}$/.test(term));
}

const ASCII_TERM_RE = /^[a-z0-9]+$/;

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  // 纯 ASCII 词必须整词匹配："ai" 作子串会命中 said/email/maintain 等，
  // 曾把大量英文技术文章误归进「人工智能」。CJK 词无词边界概念，仍用子串。
  if (ASCII_TERM_RE.test(needle)) {
    const re = new RegExp(`(?<![a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "g");
    return (haystack.match(re) || []).length;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function termsForTopic(topic: ClassifiableTopic): string[] {
  const merged = new Set<string>();
  for (const term of BUILTIN_LEXICON[topic.slug] || []) merged.add(term.toLowerCase());
  for (const term of splitKeywords(topic.keywords || "")) merged.add(term.toLowerCase());
  merged.add(topic.name.toLowerCase());
  return [...merged];
}

/**
 * 给文章挑一个最匹配的分类。返回 null 表示词库与模块信号都无法判断。
 * 同分时按 topics 数组顺序取先者（调用方按 createdAt 排序即可保证确定性）。
 */
export function classifyTopic(
  input: ClassifyInput,
  topics: ClassifiableTopic[]
): { topicId: string; slug: string; score: number } | null {
  if (!topics.length) return null;

  const title = (input.title || "").toLowerCase();
  const summary = (input.summary || "").toLowerCase();
  const content = (input.content || "").slice(0, CONTENT_EXCERPT_CHARS).toLowerCase();

  let best: { topicId: string; slug: string; score: number } | null = null;
  for (const topic of topics) {
    let score = 0;
    for (const term of termsForTopic(topic)) {
      // 每个词的命中次数封顶 3：防止一个词在正文里刷屏就碾压其他信号。
      score += Math.min(countOccurrences(title, term), 3) * 3;
      score += Math.min(countOccurrences(summary, term), 3) * 2;
      score += Math.min(countOccurrences(content, term), 3);
    }
    if (score > (best?.score ?? 0)) {
      best = { topicId: topic.id, slug: topic.slug, score };
    }
  }
  if (best && best.score >= MIN_SCORE) return best;

  // 词库没有把握时，用来源模块的语义映射兜底。
  for (const moduleSlug of input.moduleSlugs || []) {
    const hintSlug = MODULE_TOPIC_HINTS[moduleSlug];
    if (!hintSlug) continue;
    const topic = topics.find((item) => item.slug === hintSlug);
    if (topic) return { topicId: topic.id, slug: topic.slug, score: 0 };
  }
  return null;
}
