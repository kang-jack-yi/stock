import "server-only";
import type {
  ApiResult,
  Candle,
  Financials,
  Funds,
  MarketList,
  MinuteDay,
  Quote,
  SearchStock,
} from "../types";
import {
  parseCandles,
  parseFinancials,
  parseFunds,
  parseMarket,
  parseQuotes,
  parseSearch,
  validSymbol,
} from "./parse";
import { parseMinutes } from "./minute";

const QUOTES = "https://hq.sinajs.cn/";
const MARKET = "https://vip.stock.finance.sina.com.cn/quotes_service/api/";
/** 进程内上游成功响应缓存。 */
interface CacheEntry {
  /** 已规范化的业务数据，按调用泛型恢复类型。 */
  data: unknown;
  /** 获取完成的 Unix 毫秒时间。 */
  fetchedAt: number;
}
const globalCache = globalThis as typeof globalThis & {
  sinaCache?: Map<string, CacheEntry>;
  sinaRequests?: Map<string, Promise<ApiResult<unknown>>>;
};
const cache = (globalCache.sinaCache ??= new Map());
const pending = (globalCache.sinaRequests ??= new Map());
/** 仅服务端请求固定新浪域名，带 Referer、超时限制，并解码 UTF-8 或 GB18030。 */
export async function text(url: string) {
  const response = await fetch(url, {
    headers: { Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`行情数据服务暂不可用（${response.status}）`);
  const encoding = response.headers.get("content-type")?.toLowerCase().includes("utf-8")
    ? "utf-8"
    : "gb18030";
  return new TextDecoder(encoding).decode(await response.arrayBuffer());
}
/** 合并并发请求并使用有界内存缓存；上游失败时返回期限内的旧数据与降级标记。 */
export async function cached<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
): Promise<ApiResult<T>> {
  const previous = cache.get(key);
  const wrap = (entry: CacheEntry, stale: boolean): ApiResult<T> => ({
    data: entry.data as T,
    meta: {
      source: "新浪财经",
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
      stale,
      ...(stale ? { warning: "上游暂不可用，当前展示上次成功获取的数据" } : {}),
    },
  });
  if (previous && Date.now() - previous.fetchedAt < ttl) return wrap(previous, false);
  const active = pending.get(key);
  if (active) return active as Promise<ApiResult<T>>;
  const request = (async () => {
    try {
      const entry = { data: await load(), fetchedAt: Date.now() };
      if (cache.size >= 300 && !cache.has(key)) cache.delete(cache.keys().next().value!);
      cache.set(key, entry);
      return wrap(entry, false);
    } catch (error) {
      if (previous && Date.now() - previous.fetchedAt < Math.max(ttl * 10, 300000))
        return wrap(previous, true);
      throw error;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, request);
  return request;
}
/** 批量请求 1 至 60 个证券快照，扩展字段与盘口在同一次请求中获取。 */
export function quotes(symbols: string[]): Promise<ApiResult<Quote[]>> {
  if (!symbols.length || symbols.length > 60) throw new Error("每次查询 1 至 60 个股票代码");
  const unique = [...new Set(symbols.map(validSymbol))].sort();
  return cached(`quotes:${unique}`, 5000, async () => {
    const list = unique.flatMap((symbol) => [symbol, `${symbol}_i`]).join(",");
    const records = parseQuotes(await text(`${QUOTES}?list=${list}`), unique);
    if (!records.length) throw new Error("未找到这些股票的行情");
    return records;
  });
}
export const marketNodes = ["hs_a", "sh_a", "sz_a", "cyb", "kcb"] as const;
export const marketSorts = [
  "changepercent",
  "amount",
  "turnoverratio",
  "mktcap",
  "symbol",
] as const;
/** 请求指定市场、排序和页码的 20 条股票排行，返回匹配市场的总数。 */
export function market(
  node: string,
  sort: string,
  asc: string,
  page: number,
): Promise<ApiResult<MarketList>> {
  if (
    !(marketNodes as readonly string[]).includes(node) ||
    !(marketSorts as readonly string[]).includes(sort) ||
    !["0", "1"].includes(asc) ||
    page < 1 ||
    page > 500 ||
    !Number.isInteger(page)
  )
    throw new Error("股票列表查询条件不正确");
  return cached(`market:${node}:${sort}:${asc}:${page}`, 10000, async () => {
    const params = new URLSearchParams({ node, sort, asc, page: String(page), num: "20" });
    const [rows, count] = await Promise.all([
      text(`${MARKET}json_v2.php/Market_Center.getHQNodeData?${params}`),
      text(`${MARKET}json_v2.php/Market_Center.getHQNodeStockCount?node=${node}`),
    ]);
    const total = Number(count.replace(/"/g, ""));
    if (!Number.isFinite(total)) throw new Error("股票数量数据异常");
    return { stocks: parseMarket(rows), total };
  });
}
/** 获取最多 500 条日线或指定分钟线；周期限制为新浪实际支持的值。 */
export function candles(symbol: string, scale: string): Promise<ApiResult<Candle[]>> {
  validSymbol(symbol);
  if (!["5", "15", "30", "60", "240"].includes(scale)) throw new Error("不支持该 K 线周期");
  return cached(`candles:${symbol}:${scale}`, 60000, async () =>
    parseCandles(
      await text(
        `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=${scale}&ma=no&datalen=500`,
      ),
    ),
  );
}
/** 获取最近五日分时数据；行情实际日期由压缩数据提供。 */
export function minutes(symbol: string): Promise<ApiResult<MinuteDay[]>> {
  validSymbol(symbol);
  return cached(`minutes:${symbol}`, 30000, async () =>
    parseMinutes(
      await text(`https://finance.sina.com.cn/realstock/company/${symbol}/hisdata/klc_cm.js`),
    ),
  );
}
/** 使用名称、代码或拼音查询 A 股建议，查询词通过 URL 编码。 */
export function search(query: string): Promise<ApiResult<SearchStock[]>> {
  if (!query.trim() || query.length > 40) throw new Error("搜索词应为 1 至 40 个字符");
  return cached(`search:${query}`, 300000, async () =>
    parseSearch(
      await text(
        `https://suggest3.sinajs.cn/suggest/type=11&key=${encodeURIComponent(query)}&name=suggestdata`,
      ),
    ),
  );
}
/** 获取股票成交方向资金统计，按分钟缓存以减少上游请求。 */
export function funds(symbol: string): Promise<ApiResult<Funds>> {
  validSymbol(symbol);
  return cached(`funds:${symbol}`, 60000, async () =>
    parseFunds(
      await text(
        `${MARKET}jsonp.php/var%20moneyFlowData=/MoneyFlow.ssi_ssfx_flzjtj?daima=${symbol}&gettime=1`,
      ),
      symbol,
    ),
  );
}
export const financialSources = ["gjzb", "lrb", "fzb", "llb"] as const;
/** 获取关键指标或三类财务报表，六小时缓存最近八期数据。 */
export function financials(symbol: string, source: string): Promise<ApiResult<Financials>> {
  validSymbol(symbol);
  if (!(financialSources as readonly string[]).includes(source))
    throw new Error("财务报表类型不正确");
  return cached(`financials:${symbol}:${source}`, 21600000, async () =>
    parseFinancials(
      await text(
        `https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022?paperCode=${symbol}&source=${source}&type=0&page=1&num=8`,
      ),
      symbol,
      source,
    ),
  );
}
