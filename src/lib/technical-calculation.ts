import type { Candle } from "./types";
import type { PriceAdjustment, TechnicalPoint } from "./technical-types";

/** 仅允许沪深北 A 股代码，排除指数和任意上游地址。 */
export function technicalSymbol(symbol: string) {
  return /^(sh(?:60|68)\d{4}|sz(?:00|30)\d{4}|bj[489]\d{5})$/.test(symbol);
}
/** 验证真实公历日，阻止 2 月 30 日等被 Date 自动滚动。 */
export function technicalDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  );
}
/** 安全解析腾讯 JSON：固定字段、过滤超出范围的日期、相同日去重、冲突拒绝。 */
export function parseTechnicalCandles(
  value: unknown,
  symbol: string,
  adjustment: PriceAdjustment,
  from: string,
  to: string,
): Candle[] {
  if (!technicalSymbol(symbol) || !technicalDate(from) || !technicalDate(to) || from > to)
    throw new Error("日线查询条件不正确");
  const root = value as {
    /** 上游业务状态，仅数字 0 表示成功；缺失仍须拒绝。 */
    code?: unknown;
    /** 按证券代码分组的原始响应，读取前验证对象结构。 */
    data?: Record<string, unknown>;
  } | null;
  if (!root || root.code !== 0 || !root.data || typeof root.data !== "object")
    throw new Error("日线数据源返回异常");
  const record = root.data[symbol] as
    | {
        /** 未复权原始日线数组；价格元，成交量单位经板块核实后转换。 */
        day?: unknown;
        /** 前复权原始日线数组；无差异时上游可能只提供 day。 */
        qfqday?: unknown;
      }
    | undefined;
  // 上游在没有复权差异时使用 day；有 qfqday 时只能读取对应口径，不能混合价格。
  const raw = adjustment === "qfq" ? (record?.qfqday ?? record?.day) : record?.day;
  if (!Array.isArray(raw)) throw new Error("数据源没有提供所选口径日线");
  const rows = new Map<string, Candle>();
  for (const item of raw) {
    if (
      !Array.isArray(item) ||
      item.length < 6 ||
      typeof item[0] !== "string" ||
      !technicalDate(item[0])
    )
      throw new Error("日线日期或字段异常");
    if (item[0] < from || item[0] > to) continue;
    const values = item
      .slice(1, 6)
      .map((part) =>
        typeof part === "number" || (typeof part === "string" && part.trim()) ? Number(part) : NaN,
      );
    const [open, close, high, low, volume] = values;
    if (
      !values.every(Number.isFinite) ||
      Math.min(open, close, high, low) <= 0 ||
      volume < 0 ||
      low > Math.min(open, close) ||
      high < Math.max(open, close) ||
      low > high
    )
      throw new Error("日线价格或成交量异常");
    const row: Candle = {
      date: item[0],
      open,
      close,
      high,
      low,
      // 实测科创板为股；沪主板、深主板、创业板、北交所为整数手，最多有 99 股舍入差。
      volume: volume * (symbol.startsWith("sh68") ? 1 : 100),
    };
    const previous = rows.get(row.date);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row))
      throw new Error("同日存在冲突日线");
    rows.set(row.date, row);
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-640);
}

/** EMA 用首个完整 N 日均值初始化，此前返回空值，禁止零值暖机。 */
function ema(values: (number | null)[], period: number): (number | null)[] {
  let previous: number | null = null;
  const window: number[] = [];
  return values.map((value) => {
    if (value == null) return null;
    if (previous == null) {
      window.push(value);
      if (window.length < period) return null;
      previous = window.reduce((sum, item) => sum + item, 0) / period;
    } else previous += (value - previous) * (2 / (period + 1));
    return previous;
  });
}
/** 计算 MA20、MACD(12,26,9)、Wilder RSI14、BOLL(20,2)；不截断原始精度。 */
export function calculateTechnical(rows: Candle[]): TechnicalPoint[] {
  const closes = rows.map((row) => row.close);
  const short = ema(closes, 12),
    long = ema(closes, 26);
  const dif = short.map((value, i) => (value == null || long[i] == null ? null : value - long[i]!));
  const dea = ema(dif, 9);
  let gain = 0,
    loss = 0;
  return rows.map((row, i) => {
    let rsi: number | null = null;
    if (i > 0) {
      const delta = row.close - rows[i - 1].close;
      if (i <= 14) {
        gain += Math.max(delta, 0) / 14;
        loss += Math.max(-delta, 0) / 14;
      } else {
        gain = (gain * 13 + Math.max(delta, 0)) / 14;
        loss = (loss * 13 + Math.max(-delta, 0)) / 14;
      }
      if (i >= 14) rsi = gain + loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    const window = closes.slice(Math.max(0, i - 19), i + 1);
    const ma20 = window.length === 20 ? window.reduce((sum, value) => sum + value, 0) / 20 : null;
    const deviation =
      ma20 == null
        ? null
        : Math.sqrt(window.reduce((sum, value) => sum + (value - ma20) ** 2, 0) / 20);
    const volumes = rows.slice(Math.max(0, i - 5), i).map((item) => item.volume);
    const averageVolume =
      volumes.length === 5 ? volumes.reduce((sum, value) => sum + value, 0) / 5 : 0;
    return {
      ...row,
      ma20,
      dif: dif[i],
      dea: dea[i],
      macd: dif[i] == null || dea[i] == null ? null : 2 * (dif[i]! - dea[i]!),
      rsi,
      upper: ma20 == null || deviation == null ? null : ma20 + 2 * deviation,
      lower: ma20 == null || deviation == null ? null : ma20 - 2 * deviation,
      volumeRatio: averageVolume > 0 ? row.volume / averageVolume : null,
    };
  });
}
