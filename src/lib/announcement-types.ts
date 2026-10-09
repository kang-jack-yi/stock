/** 公告分类只依据公开标题推断，不代替官方公告类别或投资判断。 */
export const announcementCategories = {
  all: "全部公告",
  financial: "财报",
  dividend: "分红",
  repurchase: "回购",
  holdings: "增减持",
  other: "其他",
} as const;

/** 公告列表请求条件，日期均为中国标准时间的自然日。 */
export interface AnnouncementQuery {
  /** 带交易所前缀的 A 股代码，指数不支持。 */
  symbol: string;
  /** 标题包含的关键词，最多 40 字。 */
  keyword: string;
  /** 标题分类；all 不过滤。 */
  category: keyof typeof announcementCategories;
  /** 起始日期 YYYY-MM-DD，包含当天。 */
  start: string;
  /** 结束日期 YYYY-MM-DD，包含当天；区间最多 366 天。 */
  end: string;
  /** 从 1 开始的筛选结果页码，每页 20 条。 */
  page: number;
}

/** 经证券代码和原文地址校验的单条公告，不包含公告全文。 */
export interface AnnouncementItem {
  /** 巨潮公告 ID，用于跨页去重和稳定列表键。 */
  id: string;
  /** 查询股票代码。 */
  symbol: string;
  /** 上游证券简称。 */
  name: string;
  /** 去除上游高亮标签后的纯文本标题。 */
  title: string;
  /** 按标题推断的分类，优先级为回购、增减持、分红、财报、其他。 */
  category: Exclude<keyof typeof announcementCategories, "all">;
  /** 上游公告时间转为 ISO UTC；零点值仅代表披露日期。 */
  publishedAt: string;
  /** 上游披露日期 YYYY-MM-DD，中国标准时间。 */
  publishedDate: string;
  /** 是否带有非零的时分秒；否则界面只展示日期。 */
  hasTime: boolean;
  /** 固定 HTTPS 巨潮静态域名的 PDF 原文链接。 */
  url: string;
}

/** GET /api/announcements 的完整区间筛选结果。 */
export interface AnnouncementResult {
  /** 规范化查询条件。 */
  query: AnnouncementQuery;
  /** 本页公告，按披露时间倒序；同一时间以公告 ID 倒序稳定排列。 */
  items: AnnouncementItem[];
  /** 去重、验证和筛选后的真实公告总数。 */
  total: number;
  /** 固定每页 20 条。 */
  pageSize: number;
  /** 完整区间通过校验的公告数量，不是上游未经处理的原始总数。 */
  windowTotal: number;
}
