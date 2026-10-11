import { tradingSession } from "./trading-calendar";
import type { TechnicalPoint } from "./technical-types";
import type { SignalKind } from "./signal-types";
import type { Quote } from "./types";

/** 已核实交易日 15:05 后才检查当日完成日线；休市和未知年份不补采历史。 */
export function signalWindow(now = new Date()) {
  const session = tradingSession(now);
  const local = new Date(now.getTime() + 8 * 3600000);
  return {
    date: session.date,
    allowed: session.tradingDay && local.getUTCHours() * 60 + local.getUTCMinutes() >= 905,
    label: session.known
      ? session.tradingDay
        ? "等待当日 15:05 后有效收盘数据"
        : "休市，不生成当日技术信号"
      : "交易日历待更新，不检查技术信号",
  };
}
/** 交叉须有完整相邻指标。每日按实际有效日线比较，不虚构停牌日期。 */
export function evaluateSignal(
  kind: SignalKind,
  previous: TechnicalPoint,
  current: TechnicalPoint,
): {
  /** 相邻日线的条件输入是否完整且为有限数值，暖机不足为 false。 */
  ready: boolean;
  /** 是否在本次相邻日线之间首次跨过固定条件边界。 */
  triggered: boolean;
  /** 当前收盘价/DIF（元）、成交量倍数或 RSI 点数；缺失为 null。 */
  value: number | null;
} {
  let before: number | null, after: number | null, value: number | null;
  if (kind === "ma20Above") {
    before = previous.ma20 == null ? null : previous.close - previous.ma20;
    after = current.ma20 == null ? null : current.close - current.ma20;
    value = current.close;
  } else if (kind === "macdBullish") {
    before = previous.dif == null || previous.dea == null ? null : previous.dif - previous.dea;
    after = current.dif == null || current.dea == null ? null : current.dif - current.dea;
    value = current.dif;
  } else if (kind === "volumeSpike") {
    before = previous.volumeRatio == null ? null : previous.volumeRatio - 2;
    after = current.volumeRatio == null ? null : current.volumeRatio - 2;
    value = current.volumeRatio;
  } else {
    before = previous.rsi == null ? null : 30 - previous.rsi;
    after = current.rsi == null ? null : 30 - current.rsi;
    value = current.rsi;
  }
  const ready =
    before != null &&
    after != null &&
    value != null &&
    [before, after, value].every(Number.isFinite);
  return { ready, triggered: ready && before! <= 0 && after! > 0, value };
}
/** 比对真实收盘报价和未复权当日日线；前复权最后价必须与原价吻合。 */
export function validSignalClose(
  points: TechnicalPoint[],
  quote: Quote,
  stale: boolean,
  now: Date,
) {
  const window = signalWindow(now),
    last = points.at(-1),
    previous = points.at(-2);
  return (
    window.allowed &&
    !stale &&
    !!last &&
    !!previous &&
    last.date === window.date &&
    quote.date === window.date &&
    previous.date < last.date &&
    /^\d{2}:\d{2}:\d{2}$/.test(quote.time) &&
    quote.time >= "15:00:00" &&
    quote.time <= "23:59:59" &&
    Number(quote.time.slice(3, 5)) <= 59 &&
    Number(quote.time.slice(6, 8)) <= 59 &&
    Date.parse(`${quote.date}T${quote.time}+08:00`) <= now.getTime() &&
    quote.price != null &&
    Number.isFinite(quote.price) &&
    quote.price > 0 &&
    Math.abs(last.close - quote.price) <= 0.011 &&
    last.volume > 0 &&
    tradingSession(new Date(`${previous.date}T16:00:00+08:00`)).tradingDay
  );
}
