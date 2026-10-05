import type { MarketStock } from "./types";

/** 条件选股可排序字段，不从用户输入构建任意属性访问。 */
export const screenerSorts = [
  "changePercent",
  "amount",
  "turnover",
  "marketCap",
  "pe",
  "pb",
  "price",
] as const;

/** 当前全市场快照上的选股条件；未指定的数值边界不参与筛选。 */
export interface ScreenerFilters {
  /** 全部 A 股、沪市、深市、北交所、创业板或科创板。 */
  market: "all" | "sh" | "sz" | "bj" | "cyb" | "kcb";
  /** 股票名称或六位代码的子串，最长 40 字符。 */
  query: string;
  /** 最低价格，元，包含边界。 */
  minPrice?: number;
  /** 最高价格，元，包含边界。 */
  maxPrice?: number;
  /** 最低涨跌幅，百分比数值。 */
  minChange?: number;
  /** 最高涨跌幅，百分比数值。 */
  maxChange?: number;
  /** 最低排行接口 PE，倍，非 TTM 保证。 */
  minPe?: number;
  /** 最高排行接口 PE，倍。 */
  maxPe?: number;
  /** 最高市净率，倍。 */
  maxPb?: number;
  /** 最低换手率，百分比数值。 */
  minTurnover?: number;
  /** 最高换手率，百分比数值。 */
  maxTurnover?: number;
  /** 最低总市值，元，界面按亿元输入后转换。 */
  minCap?: number;
  /** 最高总市值，元。 */
  maxCap?: number;
  /** 最低成交额，元。 */
  minAmount?: number;
  /** true 时仅保留正 PE，表示上游盈利估值可用，不作为财务审计结论。 */
  profitable: boolean;
  /** 是否排除名称含 ST、*ST 的风险警示证券。 */
  excludeSt: boolean;
  /** 排序字段，缺失值始终置后。 */
  sort: (typeof screenerSorts)[number];
  /** asc 从低到高、desc 从高到低。 */
  order: "asc" | "desc";
  /** 从 1 开始的页码，每页 20 条。 */
  page: number;
}

/** 全市场完整快照的上涨、下跌、成交分布，不包含虚构涨停统计。 */
export interface MarketBreadth {
  /** 新浪当前 A 股证券总数，与完整快照覆盖数相等。 */
  total: number;
  /** 有有效价且涨跌幅为正的证券数量。 */
  advancing: number;
  /** 有有效价且涨跌幅为负的证券数量。 */
  declining: number;
  /** 有有效价且涨跌幅等于零的证券数量。 */
  unchanged: number;
  /** 无有效价格或涨跌幅的证券数，不能简单当作停牌。 */
  unavailable: number;
  /** 所有证券累计成交额之和，元。 */
  amount: number;
  /** 所有证券累计成交量之和，股。 */
  volume: number;
  /** 涨跌幅分布，从小于 -5% 到大于 5%，边界见 labels。 */
  distribution: number[];
  /** 与 distribution 对齐的区间文字。 */
  labels: string[];
  /** 获取开始的 ISO 时间，分页快照不是同一毫秒的交易所原子快照。 */
  startedAt: string;
}

/** GET /api/screener 的业务响应，外层使用 ApiResult。 */
export interface ScreenerResult {
  /** 当前页符合条件的真实证券，最多 20 条。 */
  stocks: MarketStock[];
  /** 全市场筛选后的总数。 */
  total: number;
  /** 筛选前完整覆盖的市场证券数。 */
  universeTotal: number;
  /** 全部 A 股快照统计；不会随着筛选条件改变统计总体。 */
  breadth: MarketBreadth;
}

/** 按代码识别交易板块；北交所新旧六位代码均使用 bj 前缀。 */
export function inMarket(symbol: string, market: ScreenerFilters["market"]) {
  if (market === "all") return true;
  if (market === "cyb") return /^sz30\d{4}$/.test(symbol);
  if (market === "kcb") return /^sh68\d{4}$/.test(symbol);
  return symbol.startsWith(market);
}

/** 缺失值在存在数值条件时排除，边界都是包含关系。 */
function between(value: number | null, minimum?: number, maximum?: number) {
  if (minimum === undefined && maximum === undefined) return true;
  return (
    value !== null &&
    (minimum === undefined || value >= minimum) &&
    (maximum === undefined || value <= maximum)
  );
}

/** 全量筛选后排序分页；空值在两种排序方向都置于最后。 */
export function screenStocks(stocks: MarketStock[], filters: ScreenerFilters) {
  const query = filters.query.trim().toLowerCase();
  const filtered = stocks.filter(
    (stock) =>
      inMarket(stock.symbol, filters.market) &&
      (!query || `${stock.name} ${stock.symbol}`.toLowerCase().includes(query)) &&
      (!filters.excludeSt || !/ST/i.test(stock.name)) &&
      (!filters.profitable || (stock.pe != null && stock.pe > 0)) &&
      between(stock.price, filters.minPrice, filters.maxPrice) &&
      between(stock.changePercent, filters.minChange, filters.maxChange) &&
      between(stock.pe, filters.minPe, filters.maxPe) &&
      between(stock.pb, undefined, filters.maxPb) &&
      between(stock.turnover, filters.minTurnover, filters.maxTurnover) &&
      between(stock.marketCap, filters.minCap, filters.maxCap) &&
      between(stock.amount, filters.minAmount),
  );
  filtered.sort((a, b) => {
    const left = a[filters.sort],
      right = b[filters.sort];
    if (left == null) return right == null ? a.symbol.localeCompare(b.symbol) : 1;
    if (right == null) return -1;
    return (
      (filters.order === "asc" ? left - right : right - left) || a.symbol.localeCompare(b.symbol)
    );
  });
  return {
    stocks: filtered.slice((filters.page - 1) * 20, filters.page * 20),
    total: filtered.length,
  };
}

/** 将完整快照划为互斥的涨跌区间，缺失报价另计。 */
export function marketBreadth(stocks: MarketStock[], startedAt: string): MarketBreadth {
  const result: MarketBreadth = {
    total: stocks.length,
    advancing: 0,
    declining: 0,
    unchanged: 0,
    unavailable: 0,
    amount: 0,
    volume: 0,
    distribution: Array(7).fill(0),
    labels: ["< −5%", "−5% 至 < −2%", "−2% 至 < 0%", "0%", "> 0% 至 2%", "> 2% 至 5%", "> 5%"],
    startedAt,
  };
  for (const stock of stocks) {
    result.amount += stock.amount;
    result.volume += stock.volume;
    const change = stock.changePercent;
    if (stock.price == null || change == null) {
      result.unavailable++;
      continue;
    }
    if (change > 0) result.advancing++;
    else if (change < 0) result.declining++;
    else result.unchanged++;
    const bucket =
      change < -5
        ? 0
        : change < -2
          ? 1
          : change < 0
            ? 2
            : change === 0
              ? 3
              : change <= 2
                ? 4
                : change <= 5
                  ? 5
                  : 6;
    result.distribution[bucket]++;
  }
  return result;
}
