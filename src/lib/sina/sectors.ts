import "server-only";
import type { ApiResult, MarketStock } from "../types";
import type { SectorConstituents, SectorKind, SectorList } from "../sector-types";
import { HttpError } from "../http";
import { cached, text } from "./client";
import { parseMarket } from "./parse";
import {
  constituentSortFields,
  parseSectorSummary,
  sectorNodePattern,
  sortSectorStocks,
} from "./sector-parse";

const MARKET = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/";
const SUMMARY = {
  industry: "https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php",
  concept: "https://vip.stock.finance.sina.com.cn/q/view/newFLJK.php?param=class",
} satisfies Record<SectorKind, string>;
/** 完整抓取的成分快照，与上游数量接口分别保留。 */
interface SectorMembers {
  /** 去重后的全部成分行情；不能以首批行情当作完整板块。 */
  stocks: MarketStock[];
  /** 上游数量接口计数，单独展示，不决定是否终止抓取。 */
  sourceStockCount: number;
}

/** 读取所选分类全部新浪板块；十秒缓存并继承上游失败的显式降级元信息。 */
export function sectors(kind: SectorKind): Promise<ApiResult<SectorList>> {
  if (kind !== "industry" && kind !== "concept") throw new HttpError("板块分类不正确");
  return cached(`sectors:${kind}`, 10000, async () => {
    const rows = parseSectorSummary(await text(SUMMARY[kind]), kind);
    return { kind, sectors: rows, total: rows.length };
  });
}

/** 按代码稳定排序抓取每页一百条至尾页；不依赖不准确的源计数提前停止。 */
function members(node: string): Promise<ApiResult<SectorMembers>> {
  return cached(`sector-members:${node}`, 60000, async () => {
    /** 查询固定新浪方法；节点已通过目录校验且 URL 参数经过编码。 */
    function pageUrl(page: number) {
      const params = new URLSearchParams({
        node,
        page: String(page),
        num: "100",
        sort: "symbol",
        asc: "1",
      });
      return `${MARKET}Market_Center.getHQNodeData?${params}`;
    }
    const [first, count] = await Promise.all([
      text(pageUrl(1)),
      text(`${MARKET}Market_Center.getHQNodeStockCount?node=${encodeURIComponent(node)}`),
    ]);
    const sourceStockCount = Number(JSON.parse(count));
    if (!Number.isInteger(sourceStockCount) || sourceStockCount < 0)
      throw new Error("板块成分数量数据异常");
    const all = new Map<string, MarketStock>();
    for (let page = 1; page <= 100; page++) {
      const raw = page === 1 ? first : await text(pageUrl(page));
      const rows = raw.trim() === "null" ? [] : parseMarket(raw);
      if (rows.length > 100 || rows.some((row) => !/^(sh|sz|bj)\d{6}$/.test(row.symbol)))
        throw new Error("板块成分行情数据异常");
      const before = all.size;
      for (const row of rows) all.set(row.symbol, row);
      if (!rows.length && !all.size && sourceStockCount > 0)
        throw new Error("板块成分行情未完整返回");
      if (rows.length < 100) return { stocks: [...all.values()], sourceStockCount };
      if (all.size === before) throw new Error("板块成分分页未前进，请稍后重试");
    }
    throw new Error("板块成分分页超过上限，未返回不完整行情");
  });
}

/** 验证真实板块后对完整成分快照排序并分页，三种数量来源均保留不相互覆盖。 */
export async function sectorConstituents(
  kind: SectorKind,
  node: string,
  sort = "changepercent",
  asc = "0",
  page = 1,
): Promise<ApiResult<SectorConstituents>> {
  if (
    !sectorNodePattern.test(node) ||
    !Object.hasOwn(constituentSortFields, sort) ||
    !["0", "1"].includes(asc) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 500
  )
    throw new HttpError("板块成分查询条件不正确");
  const catalog = await sectors(kind);
  const sector = catalog.data.sectors.find((row) => row.id === node);
  if (!sector) throw new HttpError("未找到该分类中的板块", 404);
  const complete = await members(node);
  const ordered = sortSectorStocks(
    complete.data.stocks,
    sort as keyof typeof constituentSortFields,
    asc === "1",
  );
  const result: ApiResult<SectorConstituents> = {
    data: {
      sector,
      stocks: ordered.slice((page - 1) * 20, page * 20),
      total: ordered.length,
      sourceStockCount: complete.data.sourceStockCount,
      volume: complete.data.stocks.reduce((sum, stock) => sum + stock.volume, 0),
      amount: complete.data.stocks.reduce((sum, stock) => sum + stock.amount, 0),
      leader:
        sortSectorStocks(complete.data.stocks, "changepercent", false).find(
          (stock) => stock.changePercent != null,
        ) ?? null,
      page,
      pageSize: 20,
    },
    meta: complete.meta,
  };
  // 成分行情新鲜时也不能掩盖板块汇总已使用旧缓存的事实。
  return catalog.meta.stale && !result.meta.stale
    ? {
        ...result,
        meta: {
          ...result.meta,
          stale: true,
          warning: "板块汇总暂不可用，当前采用上次成功的汇总数据",
        },
      }
    : result;
}
