import {
  announcementCategories,
  type AnnouncementItem,
  type AnnouncementQuery,
  type AnnouncementResult,
} from "./announcement-types";

const day = 86400000;

/** 返回上海当前自然日及最近一年默认查询范围，不依赖服务器本地时区。 */
export function defaultAnnouncementRange(now = new Date()) {
  const end = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return { start: new Date(Date.parse(end) - 365 * day).toISOString().slice(0, 10), end };
}

/** 只接受真实自然日，拒绝 2 月 30 日等被 Date 自动归一化的输入。 */
function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** 校验证券、关键词、日期区间和真实页码，禁止任意地址或指数查询。 */
export function parseAnnouncementQuery(params: URLSearchParams): AnnouncementQuery {
  const range = defaultAnnouncementRange();
  const symbol = params.get("symbol") || "";
  const keyword = (params.get("keyword") || "").trim();
  const category = params.get("category") || "all";
  const start = params.get("start") || range.start;
  const end = params.get("end") || range.end;
  const page = Number(params.get("page") || "1");
  if (!/^sh6\d{5}$|^sz[03]\d{5}$|^bj[489]\d{5}$/.test(symbol) || /^sz399/.test(symbol))
    throw new Error("公告查询仅支持沪、深、北 A 股代码");
  if (keyword.length > 40 || !Object.hasOwn(announcementCategories, category))
    throw new Error("公告关键词或分类不正确");
  if (
    !validDate(start) ||
    !validDate(end) ||
    start > end ||
    Date.parse(end) - Date.parse(start) > 365 * day
  )
    throw new Error("公告日期需为有效日期，且区间不超过 366 天");
  if (!Number.isInteger(page) || page < 1 || page > 30)
    throw new Error("公告页码需为 1 至 30 的整数");
  return { symbol, keyword, category: category as AnnouncementQuery["category"], start, end, page };
}

/** 按公开标题分类；回购注销、回购进展优先于可能同时出现的分红或持股字样。 */
export function classifyAnnouncement(title: string): AnnouncementItem["category"] {
  if (/回购/.test(title)) return "repurchase";
  if (/增持|减持|持股变动|权益变动/.test(title)) return "holdings";
  if (/分红|权益分派|利润分配|派息|派现|送股|转增股本/.test(title)) return "dividend";
  if (/年度报告|半年度报告|季度报告|业绩预告|业绩快报/.test(title)) return "financial";
  return "other";
}

/** 校验巨潮 JSON、证券代码、发布时间和 PDF 路径，不执行上游脚本。 */
export function parseAnnouncementPage(value: unknown, symbol: string) {
  if (!value || typeof value !== "object") throw new Error("公告数据格式不正确");
  const result = value as Record<string, unknown>;
  if (
    !Number.isInteger(result.totalAnnouncement) ||
    Number(result.totalAnnouncement) < 0 ||
    (result.announcements !== null && !Array.isArray(result.announcements))
  )
    throw new Error("公告数据暂不可用");
  const items: AnnouncementItem[] = [];
  for (const raw of (result.announcements || []) as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (
      row.secCode !== symbol.slice(2) ||
      typeof row.announcementId !== "string" ||
      !/^\d+$/.test(row.announcementId) ||
      typeof row.announcementTitle !== "string" ||
      typeof row.adjunctUrl !== "string" ||
      !/^finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.pdf$/i.test(row.adjunctUrl)
    )
      continue;
    const time = Number(row.announcementTime);
    if (!Number.isFinite(time) || time <= 0 || time > 8640000000000000 - 8 * 3600000) continue;
    const date = new Date(time);
    const local = new Date(time + 8 * 3600000).toISOString();
    const title = row.announcementTitle.replace(/<[^>]*>/g, "").trim();
    if (!title) continue;
    items.push({
      id: row.announcementId,
      symbol,
      name: typeof row.secName === "string" ? row.secName.replace(/<[^>]*>/g, "") : "",
      title,
      category: classifyAnnouncement(title),
      publishedAt: date.toISOString(),
      publishedDate: local.slice(0, 10),
      hasTime: local.slice(11, 19) !== "00:00:00",
      url: `https://static.cninfo.com.cn/${row.adjunctUrl}`,
    });
  }
  return {
    items,
    total: Number(result.totalAnnouncement),
    rawCount: Array.isArray(result.announcements) ? result.announcements.length : 0,
  };
}

/** 完整区间去重后筛选，再分页，确保总数与类别不是当前页的局部估计。 */
export function filterAnnouncements(
  items: AnnouncementItem[],
  query: AnnouncementQuery,
): AnnouncementResult {
  const unique = [...new Map(items.map((item) => [item.id, item])).values()]
    .filter(
      (item) =>
        item.symbol === query.symbol &&
        item.publishedDate >= query.start &&
        item.publishedDate <= query.end,
    )
    .sort(
      (left, right) =>
        right.publishedAt.localeCompare(left.publishedAt) || right.id.localeCompare(left.id),
    );
  const filtered = unique.filter(
    (item) =>
      (query.category === "all" || item.category === query.category) &&
      item.title.toLocaleLowerCase().includes(query.keyword.toLocaleLowerCase()),
  );
  return {
    query,
    items: filtered.slice((query.page - 1) * 20, query.page * 20),
    total: filtered.length,
    pageSize: 20,
    windowTotal: unique.length,
  };
}
