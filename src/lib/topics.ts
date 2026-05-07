import type { PrismaClient, CompilationKind } from "@prisma/client";

export type DisplayMode = "grid" | "magazine" | "list" | "topic-tabs";

export const displayModeOptions: Array<{ value: DisplayMode; label: string; description: string }> = [
  { value: "grid", label: "网格", description: "卡片网格，所有文章按时间排序，等大展示。" },
  { value: "magazine", label: "杂志大图", description: "首篇文章作为大封面，其余文章作为下方小卡片。" },
  { value: "list", label: "时间线列表", description: "单列时间线，圆点 + 日期 + 主题 + 标题 + 摘要。" },
  { value: "topic-tabs", label: "按主题分栏", description: "顶部主题标签条，点击切换到该主题的文章列表。" }
];

export function isDisplayMode(value: string): value is DisplayMode {
  return value === "grid" || value === "magazine" || value === "list" || value === "topic-tabs";
}

export function displayModeLabel(value: string) {
  return displayModeOptions.find((option) => option.value === value)?.label || "网格";
}

type DefaultTopic = {
  slug: string;
  name: string;
  description: string;
  scope: "all" | "domestic" | "international";
  keywords: string[];
  compileKind: CompilationKind;
};

export const DEFAULT_TOPICS: DefaultTopic[] = [
  {
    slug: "politics",
    name: "时政",
    description: "国家政策、政府人事、外交活动、法律法规变动等硬新闻。",
    scope: "domestic",
    keywords: ["国务院 政策", "外交部", "全国人大", "新法规"],
    compileKind: "SINGLE_ARTICLE"
  },
  {
    slug: "economy",
    name: "经济",
    description: "宏观经济走势、产业动态、金融市场、企业报道、消费民生。",
    scope: "all",
    keywords: ["宏观经济", "A股", "央行", "产业", "消费"],
    compileKind: "DAILY_DIGEST"
  },
  {
    slug: "society",
    name: "社会",
    description: "百姓日常生活相关、灾害事故、社区故事、弱势群体。",
    scope: "domestic",
    keywords: ["民生", "事故", "社区", "公共安全"],
    compileKind: "SINGLE_ARTICLE"
  },
  {
    slug: "culture-edu",
    name: "文化教育",
    description: "文艺演出、出版、文物保护、教育改革、校园动态。",
    scope: "all",
    keywords: ["教育改革", "高考", "出版", "文化遗产", "文艺"],
    compileKind: "WEEKLY_ROUNDUP"
  },
  {
    slug: "sports",
    name: "体育",
    description: "各项体育赛事、运动员动态、全民健身。",
    scope: "all",
    keywords: ["足球", "篮球", "奥运", "亚运", "运动员"],
    compileKind: "DAILY_DIGEST"
  },
  {
    slug: "technology",
    name: "科技",
    description: "科学发现、技术创新、互联网前沿、数码产品。",
    scope: "all",
    keywords: ["人工智能", "芯片", "新能源", "互联网", "航天"],
    compileKind: "SINGLE_ARTICLE"
  },
  {
    slug: "entertainment",
    name: "娱乐",
    description: "影视、音乐、明星动态、综艺、时尚。",
    scope: "all",
    keywords: ["电影", "音乐", "综艺", "时尚"],
    compileKind: "WEEKLY_ROUNDUP"
  },
  {
    slug: "international",
    name: "国际",
    description: "国与国关系、全球性议题。",
    scope: "international",
    keywords: ["国际局势", "联合国", "峰会", "国际组织"],
    compileKind: "SINGLE_ARTICLE"
  },
  {
    slug: "domestic",
    name: "国内",
    description: "本国各地要闻。",
    scope: "domestic",
    keywords: ["全国", "各地", "省委", "市政"],
    compileKind: "DAILY_DIGEST"
  },
  {
    slug: "local",
    name: "本地",
    description: "特定城市或社区的身边事；管理员可在此基础上替换为自己关心的城市关键词。",
    scope: "domestic",
    keywords: ["本地", "社区"],
    compileKind: "SINGLE_ARTICLE"
  }
];

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export async function seedDefaultTopics(prisma: PrismaClient) {
  for (const topic of DEFAULT_TOPICS) {
    const where = { OR: [{ slug: topic.slug }, { name: topic.name }] };
    const existing = await prisma.newsTopic.findFirst({ where, select: { id: true } });
    if (existing) continue;

    try {
      await prisma.newsTopic.create({
        data: {
          slug: topic.slug,
          name: topic.name,
          description: topic.description,
          scope: topic.scope,
          keywords: topic.keywords.join("\n"),
          compileKind: topic.compileKind,
          articleCount: 1,
          depth: "long",
          isEnabled: false
        }
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const createdByAnotherProcess = await prisma.newsTopic.findFirst({ where, select: { id: true } });
      if (!createdByAnotherProcess) throw error;
    }
  }
}
