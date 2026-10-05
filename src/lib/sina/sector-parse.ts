import type { SectorKind, SectorSummary } from "../sector-types";
import type { MarketStock, Numeric } from "../types";
import { numeric, symbolPattern } from "./parse";

/** 板块代码只允许已验证的新浪行业和概念格式；不接受任意路径或 URL。 */
export const sectorNodePattern = /^(?:new_|gn_)[a-zA-Z0-9_]{1,40}$/;

/** 成分排序只映射到项目已规范化的行情字段。 */
export const constituentSortFields = {
  changepercent: "changePercent",
  pricechange: "change",
  amount: "amount",
  volume: "volume",
  turnoverratio: "turnover",
  mktcap: "marketCap",
  trade: "price",
  symbol: "symbol",
} satisfies Record<string, keyof MarketStock>;

/** 完整成分快照先排序再分页；缺失指标始终排最后，金额和股数已统一单位。 */
export function sortSectorStocks(
  stocks: MarketStock[],
  sort: keyof typeof constituentSortFields,
  asc: boolean,
): MarketStock[] {
  const field = constituentSortFields[sort];
  return stocks.toSorted((a, b) => {
    const left = a[field],
      right = b[field];
    if (left == null) return right == null ? a.symbol.localeCompare(b.symbol) : 1;
    if (right == null) return -1;
    const delta =
      typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right)
        : Number(left) - Number(right);
    return (asc ? delta : -delta) || a.symbol.localeCompare(b.symbol);
  });
}

/** 成交量、金额及均价的负数没有业务意义；缺失或无效值保留 null。 */
function nonnegative(value: unknown): Numeric {
  const result = numeric(value);
  return result != null && result >= 0 ? result : null;
}

/** 从严格赋值包装提取 JSON，不执行远端 JavaScript，保留完整板块和原始汇总口径。 */
export function parseSectorSummary(text: string, kind: SectorKind): SectorSummary[] {
  const name = kind === "industry" ? "sinaindustry" : "class";
  const match = text.match(
    new RegExp(`^\\s*var\\s+S_Finance_bankuai_${name}\\s*=\\s*(\\{[\\s\\S]*\\})\\s*;?\\s*$`),
  );
  if (!match) throw new Error("板块汇总数据格式异常");
  const raw: unknown = JSON.parse(match[1]);
  if (!raw || Array.isArray(raw) || typeof raw !== "object")
    throw new Error("板块汇总数据格式异常");
  const sectors = Object.entries(raw).map(([id, value]) => {
    if (!sectorNodePattern.test(id) || typeof value !== "string")
      throw new Error("板块汇总数据格式异常");
    const fields = value.split(",");
    if (fields.length < 13 || fields[0] !== id || !fields[1])
      throw new Error("板块汇总数据格式异常");
    const count = nonnegative(fields[2]);
    return {
      id,
      name: fields[1],
      kind,
      reportedStockCount: count != null && Number.isInteger(count) ? count : null,
      averagePrice: nonnegative(fields[3]),
      change: numeric(fields[4]),
      changePercent: numeric(fields[5]),
      // 股/元已逐项核实；部分概念源汇总仅含一百只，不能当作全部成分统计。
      volume: nonnegative(fields[6]),
      amount: nonnegative(fields[7]),
      leaderSymbol: symbolPattern.test(fields[8]) ? fields[8] : null,
      leaderChangePercent: numeric(fields[9]),
      leaderPrice: nonnegative(fields[10]),
      leaderChange: numeric(fields[11]),
      leaderName: fields.slice(12).join(",") || null,
    } satisfies SectorSummary;
  });
  if (!sectors.length) throw new Error("暂无板块汇总数据");
  return sectors;
}
