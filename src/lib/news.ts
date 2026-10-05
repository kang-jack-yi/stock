/** 已验证的新浪滚动新闻分类，对应其官方财经滚动页。 */
export const newsCategories = ["finance", "stocks", "world"] as const;

/** 单条资讯只展示标题、出处、时间和原文链接，不抓取或转载全文。 */
export interface NewsItem {
  /** 原始文档 ID，用作稳定的列表键。 */
  id: string;
  /** 新浪提供的文章标题，作为纯文本渲染。 */
  title: string;
  /** 经验证的新浪 HTTPS 原文 URL。 */
  url: string;
  /** 首次发布时间，ISO UTC。 */
  publishedAt: string;
  /** 原始媒体署名；缺失时返回提供方名称，界面可隐藏该署名。 */
  source: string;
}

/** GET /api/news 响应业务数据，外层为 ApiResult。 */
export interface NewsResult {
  /** finance 财经、stocks 股市、world 环球。 */
  category: (typeof newsCategories)[number];
  /** 本页最多 20 条，按新浪原始时间顺序。 */
  items: NewsItem[];
  /** 上游该分类的记录总量。 */
  total: number;
}

/** 验证原文域名和时间并去重，拒绝脚本 URL 和 HTML 文本注入。 */
export function parseNews(text: string, category: NewsResult["category"]): NewsResult {
  const result = JSON.parse(text).result;
  if (result?.status?.code !== 0 || !Array.isArray(result.data))
    throw new Error("资讯数据暂不可用");
  const seen = new Set<string>();
  const items: NewsItem[] = result.data.flatMap((item: Record<string, unknown>) => {
    if (
      typeof item.docid !== "string" ||
      typeof item.title !== "string" ||
      typeof item.url !== "string"
    )
      return [];
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      return [];
    }
    const date = Number(item.ctime) * 1000;
    if (
      url.protocol !== "https:" ||
      !/(^|\.)sina\.com\.cn$|(^|\.)sina\.cn$/.test(url.hostname) ||
      !Number.isFinite(date) ||
      date <= 0 ||
      seen.has(item.docid)
    )
      return [];
    seen.add(item.docid);
    return [
      {
        id: item.docid,
        title: item.title.replace(/<[^>]*>/g, ""),
        url: url.href,
        publishedAt: new Date(date).toISOString(),
        source:
          typeof item.media_name === "string" && item.media_name ? item.media_name : "新浪财经",
      },
    ];
  });
  return { category, items, total: Number(result.total) || 0 };
}
