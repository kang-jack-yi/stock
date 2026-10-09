import { screenStocks, type ScreenerFilters } from "./screener";
import { tradingSession } from "./trading-calendar";
import type { ApiMeta, MarketStock, Quote } from "./types";
import type { ReviewScreener, ReviewScreenerChange, ReviewSectorChange } from "./review-types";
import type { SectorSummary } from "./sector-types";

/** 只在已核实交易日的 15:05 至 23:59 采集，留出上游收盘写入时间。 */
export function reviewCaptureWindow(now = new Date()) {
  const session = tradingSession(now);
  const minute = (now.getUTCHours() * 60 + now.getUTCMinutes() + 480) % 1440;
  return {
    date: session.date,
    allowed: session.known && session.tradingDay && minute >= 905,
    label: !session.known
      ? "交易日历待更新，暂停采集"
      : !session.tradingDay
        ? "休市，当天不生成收盘快照"
        : minute < 905
          ? "等待 15:05 后采集当日收盘"
          : "可以采集当日收盘快照",
  };
}

/** 成功响应必须在当天收盘后获取，降级缓存与跨日响应不能入库。 */
export function validReviewMeta(meta: ApiMeta, date: string, now: Date) {
  const fetched = Date.parse(meta.fetchedAt);
  return (
    !meta.stale &&
    Number.isFinite(fetched) &&
    fetched >= Date.parse(`${date}T15:00:00+08:00`) &&
    fetched <= now.getTime() + 60000 &&
    new Date(fetched + 8 * 3600000).toISOString().slice(0, 10) === date
  );
}

/** 对真实快照日期、时间与有效价格逐只核实；旧价不能作为当天收盘。 */
export function reviewQuoteIssue(quote: Quote | undefined, date: string) {
  if (!quote) return "行情缺失，未参与当日统计";
  if (quote.date !== date) return `行情日期 ${quote.date || "未知"}，未参与当日统计`;
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(quote.time) || quote.time < "15:00:00")
    return "尚无可验证收盘时间，未参与当日统计";
  if (quote.time > "23:59:59") return "行情时间无效，未参与当日统计";
  if (
    quote.price == null ||
    !Number.isFinite(quote.price) ||
    quote.price <= 0 ||
    quote.changePercent == null ||
    !Number.isFinite(quote.changePercent)
  )
    return "无有效收盘价格或涨幅，可能停牌，未参与当日统计";
  return null;
}

/** 排行无日期，价格与涨幅必须和已核实日期的证券快照一致。 */
export function alignedReviewStock(stock: MarketStock, quote: Quote) {
  return (
    stock.price != null &&
    quote.price != null &&
    stock.changePercent != null &&
    quote.changePercent != null &&
    Math.abs(stock.price - quote.price) < 0.011 &&
    Math.abs(stock.changePercent - quote.changePercent) < 0.011
  );
}

/** 排序、分页不影响条件语义；按键排序得到稳定哈希输入。 */
export function reviewConditionKey(filters: Omit<ScreenerFilters, "page">) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(filters)
        .filter(([key, value]) => !["sort", "order", "page"].includes(key) && value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

/** 在已核实完整覆盖集合上逐只筛选，不受二十条展示分页限制。 */
export function reviewMatches(stocks: MarketStock[], filters: Omit<ScreenerFilters, "page">) {
  return stocks
    .filter((stock) => screenStocks([stock], { ...filters, page: 1 }).total > 0)
    .map(({ symbol, name }) => ({ symbol, name }));
}

/** 只在相邻快照中存在同编号、同条件方案时计算新增与退出。 */
export function compareReviewScreeners(
  current: ReviewScreener[],
  previous: ReviewScreener[] = [],
  currentExcluded: string[] = [],
  previousExcluded: string[] = [],
): ReviewScreenerChange[] {
  return current.map((scheme) => {
    const before = previous.find((row) => row.id === scheme.id);
    const hasBaseline = !!before && before.conditionHash === scheme.conditionHash;
    const beforeSet = new Set(before?.matches.map((row) => row.symbol));
    const currentSet = new Set(scheme.matches.map((row) => row.symbol));
    const added = hasBaseline ? scheme.matches.filter((row) => !beforeSet.has(row.symbol)) : [];
    const removed = hasBaseline ? before!.matches.filter((row) => !currentSet.has(row.symbol)) : [];
    const invalidCurrent = new Set(currentExcluded);
    const invalidPrevious = new Set(previousExcluded);
    return {
      ...scheme,
      hasBaseline,
      baselineLabel: !before
        ? "暂无相邻快照基线，从今天开始积累"
        : !hasBaseline
          ? "方案条件已变化，重新建立基线"
          : "与相邻可用快照的相同条件比较",
      added: added.filter((row) => !invalidPrevious.has(row.symbol)),
      removed: removed.filter((row) => !invalidCurrent.has(row.symbol)),
      unverifiable: [
        ...added.filter((row) => invalidPrevious.has(row.symbol)),
        ...removed.filter((row) => invalidCurrent.has(row.symbol)),
      ],
    };
  });
}

/** 板块以分类和编号对应，不把两个板块分类的同名条目混合。 */
export function compareReviewSectors(
  current: SectorSummary[],
  previous: SectorSummary[] = [],
): ReviewSectorChange[] {
  const before = new Map(previous.map((row) => [`${row.kind}:${row.id}`, row]));
  return current.map((row) => {
    const previousChangePercent = before.get(`${row.kind}:${row.id}`)?.changePercent ?? null;
    return {
      ...row,
      previousChangePercent,
      difference:
        row.changePercent != null && previousChangePercent != null
          ? row.changePercent - previousChangePercent
          : null,
    };
  });
}
