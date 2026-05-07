import type { PrismaClient } from "@prisma/client";

type DefaultSource = {
  name: string;
  url: string;
  type: "WEB" | "RSS";
  region: "DOMESTIC" | "INTERNATIONAL";
};

type DefaultModule = {
  slug: string;
  name: string;
  description: string;
  color: string;
  sortOrder: number;
  sources: DefaultSource[];
};

export const DEFAULT_MODULES: DefaultModule[] = [
  {
    slug: "general-news",
    name: "综合资讯",
    description: "中外主流综合性新闻媒体,覆盖每日要闻。",
    color: "#9f4f2f",
    sortOrder: 10,
    sources: [
      { name: "澎湃新闻", url: "https://www.thepaper.cn/", type: "WEB", region: "DOMESTIC" },
      { name: "新华网要闻", url: "http://www.xinhuanet.com/politics/", type: "WEB", region: "DOMESTIC" },
      { name: "央视新闻", url: "https://news.cctv.com/", type: "WEB", region: "DOMESTIC" },
      { name: "The Guardian World", url: "https://www.theguardian.com/world/rss", type: "RSS", region: "INTERNATIONAL" },
      { name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", type: "RSS", region: "INTERNATIONAL" },
      { name: "NHK World", url: "https://www3.nhk.or.jp/nhkworld/en/news/rss/", type: "RSS", region: "INTERNATIONAL" }
    ]
  },
  {
    slug: "finance",
    name: "财经商业",
    description: "宏观经济、金融市场、产业与企业报道。",
    color: "#2c6e8e",
    sortOrder: 20,
    sources: [
      { name: "财新网", url: "https://www.caixin.com/", type: "WEB", region: "DOMESTIC" },
      { name: "第一财经", url: "https://www.yicai.com/", type: "WEB", region: "DOMESTIC" },
      { name: "华尔街见闻", url: "https://wallstreetcn.com/", type: "WEB", region: "DOMESTIC" },
      { name: "FT 中文网", url: "https://www.ftchinese.com/rss/feed", type: "RSS", region: "DOMESTIC" },
      { name: "Bloomberg Markets", url: "https://feeds.bloomberg.com/markets/news.rss", type: "RSS", region: "INTERNATIONAL" },
      { name: "The Economist Finance", url: "https://www.economist.com/finance-and-economics/rss.xml", type: "RSS", region: "INTERNATIONAL" }
    ]
  },
  {
    slug: "tech",
    name: "科技互联网",
    description: "互联网产品、消费电子、行业前沿与创业动态(与 AI 模块互补)。",
    color: "#00b08a",
    sortOrder: 30,
    sources: [
      { name: "36氪", url: "https://36kr.com/feed", type: "RSS", region: "DOMESTIC" },
      { name: "虎嗅", url: "https://www.huxiu.com/rss/0.xml", type: "RSS", region: "DOMESTIC" },
      { name: "少数派", url: "https://sspai.com/feed", type: "RSS", region: "DOMESTIC" },
      { name: "爱范儿", url: "https://www.ifanr.com/feed", type: "RSS", region: "DOMESTIC" },
      { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", type: "RSS", region: "INTERNATIONAL" },
      { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", type: "RSS", region: "INTERNATIONAL" },
      { name: "TechCrunch", url: "https://techcrunch.com/feed/", type: "RSS", region: "INTERNATIONAL" }
    ]
  },
  {
    slug: "international",
    name: "国际视野",
    description: "国际关系、地缘政治与跨地区议题。",
    color: "#4a3b6b",
    sortOrder: 40,
    sources: [
      { name: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", type: "RSS", region: "INTERNATIONAL" },
      { name: "Al Jazeera English", url: "https://www.aljazeera.com/xml/rss/all.xml", type: "RSS", region: "INTERNATIONAL" },
      { name: "Foreign Policy", url: "https://foreignpolicy.com/feed/", type: "RSS", region: "INTERNATIONAL" },
      { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", type: "RSS", region: "INTERNATIONAL" },
      { name: "端传媒", url: "https://theinitium.com/", type: "WEB", region: "INTERNATIONAL" }
    ]
  },
  {
    slug: "academic",
    name: "学术研究",
    description: "论文预印本、顶刊新闻与科普重磅。",
    color: "#2f7a4f",
    sortOrder: 50,
    sources: [
      { name: "arXiv cs.AI", url: "https://export.arxiv.org/rss/cs.AI", type: "RSS", region: "INTERNATIONAL" },
      { name: "arXiv cs.LG", url: "https://export.arxiv.org/rss/cs.LG", type: "RSS", region: "INTERNATIONAL" },
      { name: "arXiv stat.ML", url: "https://export.arxiv.org/rss/stat.ML", type: "RSS", region: "INTERNATIONAL" },
      { name: "Nature News", url: "https://www.nature.com/nature.rss", type: "RSS", region: "INTERNATIONAL" },
      { name: "Science Magazine", url: "https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science", type: "RSS", region: "INTERNATIONAL" },
      { name: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/", type: "RSS", region: "INTERNATIONAL" }
    ]
  },
  {
    slug: "developers",
    name: "开发者社区",
    description: "工程文化、开源动态、社区头条。",
    color: "#1a1a1a",
    sortOrder: 60,
    sources: [
      { name: "Hacker News Front Page", url: "https://hnrss.org/frontpage", type: "RSS", region: "INTERNATIONAL" },
      { name: "Lobsters", url: "https://lobste.rs/rss", type: "RSS", region: "INTERNATIONAL" },
      { name: "Dev.to", url: "https://dev.to/feed", type: "RSS", region: "INTERNATIONAL" },
      { name: "GitHub Blog", url: "https://github.blog/feed/", type: "RSS", region: "INTERNATIONAL" },
      { name: "阮一峰科技爱好者周刊", url: "https://www.ruanyifeng.com/blog/atom.xml", type: "RSS", region: "DOMESTIC" }
    ]
  },
  {
    slug: "design",
    name: "设计与创意",
    description: "交互设计、视觉设计与创意行业。",
    color: "#c75c8e",
    sortOrder: 70,
    sources: [
      { name: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", type: "RSS", region: "INTERNATIONAL" },
      { name: "A List Apart", url: "https://alistapart.com/main/feed/", type: "RSS", region: "INTERNATIONAL" },
      { name: "It's Nice That", url: "https://www.itsnicethat.com/feed", type: "RSS", region: "INTERNATIONAL" },
      { name: "Sidebar", url: "https://sidebar.io/feed.xml", type: "RSS", region: "INTERNATIONAL" }
    ]
  },
  {
    slug: "culture",
    name: "文化人文",
    description: "文学、艺术、思想与生活方式。",
    color: "#d4a056",
    sortOrder: 80,
    sources: [
      { name: "三联生活周刊", url: "https://www.lifeweek.com.cn/", type: "WEB", region: "DOMESTIC" },
      { name: "单向街", url: "https://www.owspace.com/", type: "WEB", region: "DOMESTIC" },
      { name: "The New Yorker · Culture", url: "https://www.newyorker.com/feed/culture", type: "RSS", region: "INTERNATIONAL" },
      { name: "Aeon", url: "https://aeon.co/feed.rss", type: "RSS", region: "INTERNATIONAL" },
      { name: "Los Angeles Review of Books", url: "https://lareviewofbooks.org/feed/", type: "RSS", region: "INTERNATIONAL" }
    ]
  },
  {
    slug: "indie-writing",
    name: "独立写作",
    description: "个人 Newsletter、Substack 与高质量长文专栏。",
    color: "#6b8e7a",
    sortOrder: 90,
    sources: [
      { name: "Stratechery (Ben Thompson)", url: "https://stratechery.com/feed/", type: "RSS", region: "INTERNATIONAL" },
      { name: "Paul Graham · Essays", url: "https://www.aaronsw.com/2002/feeds/pgessays.rss", type: "RSS", region: "INTERNATIONAL" },
      { name: "Marginal Revolution", url: "https://marginalrevolution.com/feed", type: "RSS", region: "INTERNATIONAL" },
      { name: "The Pragmatic Engineer", url: "https://newsletter.pragmaticengineer.com/feed", type: "RSS", region: "INTERNATIONAL" },
      { name: "One Useful Thing (Ethan Mollick)", url: "https://www.oneusefulthing.org/feed", type: "RSS", region: "INTERNATIONAL" },
      { name: "Sebastian Raschka", url: "https://magazine.sebastianraschka.com/feed", type: "RSS", region: "INTERNATIONAL" }
    ]
  },
  {
    slug: "science-popular",
    name: "科普思辨",
    description: "通俗科普、批判性思维、长文随笔。",
    color: "#5a7a9a",
    sortOrder: 100,
    sources: [
      { name: "知乎日报", url: "https://daily.zhihu.com/", type: "WEB", region: "DOMESTIC" },
      { name: "果壳", url: "https://www.guokr.com/", type: "WEB", region: "DOMESTIC" },
      { name: "Scientific American", url: "https://www.scientificamerican.com/feed/", type: "RSS", region: "INTERNATIONAL" },
      { name: "Astral Codex Ten", url: "https://www.astralcodexten.com/feed", type: "RSS", region: "INTERNATIONAL" },
      { name: "LessWrong", url: "https://www.lesswrong.com/feed.xml", type: "RSS", region: "INTERNATIONAL" }
    ]
  }
];

type SourceModuleClient = {
  findFirst: (args: {
    where: { OR: Array<{ slug: string } | { name: string }> };
    select: { id: true; slug: true };
  }) => Promise<{ id: string; slug: string } | null>;
  create: (args: {
    data: { slug: string; name: string; description: string; color: string; sortOrder: number };
  }) => Promise<{ id: string; slug: string }>;
};

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export async function seedDefaultModules(prisma: PrismaClient) {
  const sourceModule = (prisma as unknown as { sourceModule: SourceModuleClient }).sourceModule;

  for (const m of DEFAULT_MODULES) {
    const where = { OR: [{ slug: m.slug }, { name: m.name }] };
    let moduleRow = await sourceModule.findFirst({ where, select: { id: true, slug: true } });
    if (!moduleRow) {
      try {
        moduleRow = await sourceModule.create({
          data: {
            slug: m.slug,
            name: m.name,
            description: m.description,
            color: m.color,
            sortOrder: m.sortOrder
          }
        });
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        moduleRow = await sourceModule.findFirst({ where, select: { id: true, slug: true } });
        if (!moduleRow) throw error;
      }
    }

    const existing = await prisma.source.findFirst({
      where: { modules: { some: { id: moduleRow.id } } },
      select: { id: true }
    });
    if (existing) continue;

    for (const src of m.sources) {
      const found = await prisma.source.findFirst({ where: { url: src.url } });
      if (found) {
        await prisma.source.update({
          where: { id: found.id },
          data: { modules: { connect: { id: moduleRow.id } } }
        });
      } else {
        await prisma.source.create({
          data: {
            name: src.name,
            url: src.url,
            type: src.type,
            region: src.region,
            modules: { connect: { id: moduleRow.id } }
          }
        });
      }
    }
  }
}
