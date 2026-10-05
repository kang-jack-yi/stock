import "server-only";
import { cached, text } from "./client";
import { parseMarket, symbolPattern } from "./parse";
import {
  marketBreadth,
  screenStocks,
  type ScreenerFilters,
  type ScreenerResult,
  type MarketBreadth,
} from "../screener";
import type { ApiResult, MarketStock } from "../types";

const API = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.";
/** 完整市场快照，仅在服务端保留，用于全量筛选和市场宽度统计。 */
interface Universe {
  /** 全部有效证券代码行，去重后数量与源总数一致。 */
  stocks: MarketStock[];
  /** 基于完整证券集合的统计。 */
  breadth: MarketBreadth;
}

/** 全量拉取 A 股，每页实际最多 100 条，并发 4 个请求避免集中压迫上游。 */
async function universe(): Promise<ApiResult<Universe>> {
  return cached("universe:hs_a", 300000, async () => {
    const startedAt = new Date().toISOString();
    const count = Number((await text(`${API}getHQNodeStockCount?node=hs_a`)).replace(/"/g, ""));
    if (!Number.isInteger(count) || count < 100 || count > 15000)
      throw new Error("全市场证券数量异常");
    const pages = Math.ceil(count / 100),
      rows: MarketStock[][] = Array(pages);
    let cursor = 0;
    /** 各 worker 顺序领取未完成页面，请求失败时整批不当作完整快照返回。 */
    async function worker() {
      while (cursor < pages) {
        const index = cursor++;
        rows[index] = parseMarket(
          await text(`${API}getHQNodeData?node=hs_a&sort=symbol&asc=1&page=${index + 1}&num=100`),
        );
      }
    }
    await Promise.all(Array.from({ length: 4 }, () => worker()));
    const stocks = [
      ...new Map(
        rows
          .flat()
          .filter((row) => symbolPattern.test(row.symbol))
          .map((row) => [row.symbol, row]),
      ).values(),
    ];
    if (stocks.length !== count) throw new Error("全市场快照未完整返回，请稍后刷新重试");
    return { stocks, breadth: marketBreadth(stocks, startedAt) };
  });
}

/** 对同一五分钟快照执行条件查询，分页只影响展示，不缩小筛选范围。 */
export async function screener(filters: ScreenerFilters): Promise<ApiResult<ScreenerResult>> {
  const snapshot = await universe();
  return {
    data: {
      ...screenStocks(snapshot.data.stocks, filters),
      universeTotal: snapshot.data.stocks.length,
      breadth: snapshot.data.breadth,
    },
    meta: snapshot.meta,
  };
}

/** 返回全市场上涨、下跌和成交额统计，供总览和选股共用完整快照。 */
export async function breadth(): Promise<ApiResult<MarketBreadth>> {
  const snapshot = await universe();
  return { data: snapshot.data.breadth, meta: snapshot.meta };
}
