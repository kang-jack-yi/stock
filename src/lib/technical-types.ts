import type { Candle } from "./types";

/** 日线价格口径；成交量始终为实际成交股数，不复权。 */
export type PriceAdjustment = "none" | "qfq";
/** 使用完整窗口计算的日线指标；暖机不足时为 null。 */
export interface TechnicalPoint extends Candle {
  /** 20 日收盘价简单均线，元。 */
  ma20: number | null;
  /** EMA12 − EMA26，元；EMA 用首个完整窗口均值初始化。 */
  dif: number | null;
  /** DIF 的 9 期 EMA，元；首次 9 个 DIF 均值初始化。 */
  dea: number | null;
  /** 2 ×（DIF − DEA），元。 */
  macd: number | null;
  /** Wilder RSI14，0 至 100；连续不涨不跌时为 50。 */
  rsi: number | null;
  /** 布林上轨，MA20 + 2 倍总体标准差，元。 */
  upper: number | null;
  /** 布林下轨，MA20 − 2 倍总体标准差，元。 */
  lower: number | null;
  /** 当日成交量 / 此前 5 个有效日线的平均量，倍；分母零为 null。 */
  volumeRatio: number | null;
}
/** GET /api/technical 返回真实有限日线与计算口径。 */
export interface TechnicalResult {
  /** 证券代码，仅 A 股，不含指数。 */
  symbol: string;
  /** 用户选择的价格口径。 */
  adjustment: PriceAdjustment;
  /** 按日期升序，最多 640 条；首次挂牌或停牌会减少记录数。 */
  points: TechnicalPoint[];
  /** 本次查询的最早允许日期，中国标准时间。 */
  from: string;
  /** 本次查询的最晚允许日期，不以抓取时间补充源日期。 */
  to: string;
  /** 说明有限历史、暖机与成交量舍入等限制。 */
  warning: string;
}
