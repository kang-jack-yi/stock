import type { Candle, Quote } from "./types";

/** 相同日期、相同起点的比较曲线；不会插值补造缺失交易日。 */
export interface ComparisonSeries {
  /** 带交易所前缀的证券代码。 */
  symbol: string;
  /** 证券显示名称。 */
  name: string;
  /** 与 dates 对齐的未复权收盘价，元或点。 */
  closes: number[];
  /** 相对第一个共同日期收盘价的涨跌幅，百分比数值，起点为零。 */
  returns: number[];
  /** 最后共同日期相对于首个共同日期的涨跌幅，百分比数值。 */
  totalReturn: number;
  /** 共同交易日收盘价序列的最大回撤，负百分比数值或 0。 */
  maxDrawdown: number;
  /** 共同交易日的平均成交量，股。 */
  averageVolume: number;
}

/** GET /api/compare，行情指标和历史走势分别标明时点。 */
export interface ComparisonResult {
  /** 最新行情，与历史共同日期的结束时间可能不同。 */
  quotes: Quote[];
  /** 全部所选证券都具有有效收盘价的共同交易日，按升序。 */
  dates: string[];
  /** 至多四条完整、对齐且具有相同基准的曲线。 */
  series: ComparisonSeries[];
  /** 请求的交易日数量；新上市或缺失数据可能减少实际共同天数。 */
  requestedDays: number;
}

/** 先求日期交集再截取窗口，以同一交易日的基准比较；价格使用未复权收盘价。 */
export function compareCandles(
  items: { symbol: string; name: string; candles: Candle[] }[],
  days: number,
) {
  if (!items.length) return { dates: [], series: [] };
  const maps = items.map(
    (item) =>
      new Map(
        item.candles.filter((row) => row.close > 0).map((row) => [row.date.slice(0, 10), row]),
      ),
  );
  const dates = [...maps[0].keys()]
    .filter((date) => maps.every((map) => map.has(date)))
    .sort()
    .slice(-days);
  if (dates.length < 2) throw new Error("所选证券共同交易日不足，无法计算区间比较");
  const series: ComparisonSeries[] = items.map((item, i) => {
    const rows = dates.map((date) => maps[i].get(date)!);
    const closes = rows.map((row) => row.close),
      base = closes[0];
    let peak = base,
      maxDrawdown = 0;
    for (const close of closes) {
      peak = Math.max(peak, close);
      maxDrawdown = Math.min(maxDrawdown, (close / peak - 1) * 100);
    }
    const returns = closes.map((close) => (close / base - 1) * 100);
    return {
      symbol: item.symbol,
      name: item.name,
      closes,
      returns,
      totalReturn: returns.at(-1)!,
      maxDrawdown,
      averageVolume: rows.reduce((sum, row) => sum + row.volume, 0) / rows.length,
    };
  });
  return { dates, series };
}
