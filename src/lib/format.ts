import type { Numeric } from "./types";

/** 格式化价格或指标并保留指定小数位，缺失值显示破折号。 */
export function number(value: Numeric | undefined, digits = 2) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("zh-CN", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
}
/** 为正涨跌额添加加号，负值保留负号。 */
export function signed(value: Numeric | undefined, digits = 2) {
  return value == null ? "—" : `${value > 0 ? "+" : ""}${number(value, digits)}`;
}
/** 展示百分比数值，入参 1.5 显示为 +1.50%。 */
export function percent(value: Numeric | undefined) {
  return value == null ? "—" : `${signed(value)}%`;
}
/** 将大数缩写为万或亿，suffix 可指定金额或成交量单位。 */
export function compact(value: Numeric | undefined, suffix = "") {
  if (value == null) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1e8) return `${number(value / 1e8)}亿${suffix}`;
  if (absolute >= 1e4) return `${number(value / 1e4)}万${suffix}`;
  return `${number(value, 0)}${suffix}`;
}
/** 按数值正负返回涨跌样式名，零和缺失值使用中性色。 */
export function direction(value: Numeric | undefined) {
  return value == null || value === 0 ? "flat" : value > 0 ? "up" : "down";
}
/** 沪市指数以 sh000、深市指数以 sz399 开头，与股票代码区分。 */
export function isIndex(symbol: string) {
  return /^sh000\d{3}$|^sz399\d{3}$/.test(symbol);
}
/** 返回交易所展示缩写，避免将北交所误标为深交所。 */
export function exchange(symbol: string) {
  return symbol.startsWith("sh") ? "SH" : symbol.startsWith("bj") ? "BJ" : "SZ";
}
/** 按中国标准时间判断工作日交易时段；节假日由上游行情日期体现。 */
export function tradingHours() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  return (
    !["Sat", "Sun"].includes(get("weekday")) &&
    ((minute >= 555 && minute <= 690) || (minute >= 780 && minute <= 910))
  );
}
