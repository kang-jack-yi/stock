/** 交易所发布的年度休市区间；周末调休不属于证券交易日。 */
const holidays: Record<number, [string, string][]> = {
  2026: [
    ["01-01", "01-03"],
    ["02-15", "02-23"],
    ["04-04", "04-06"],
    ["05-01", "05-05"],
    ["06-19", "06-21"],
    ["09-25", "09-27"],
    ["10-01", "10-07"],
  ],
};
/** 日历依据；跨年之前应按交易所下一年度公告更新。 */
export const calendarSource =
  "https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20251222_10802510.shtml";
/** 当前交易时段；未知年份不会按普通工作日猜测开市。 */
export interface TradingSession {
  /** 中国标准时间日期，YYYY-MM-DD。 */
  date: string;
  /** 当前年度是否有已核实日历。 */
  known: boolean;
  /** 是否为交易日。未知年度为 false。 */
  tradingDay: boolean;
  /** 当前是否位于连续交易时段。 */
  active: boolean;
  /** 对用户可见的状态。 */
  label: string;
}
/** 使用固定 UTC+8 得到交易所日期与分钟，避免部署主机时区影响。 */
export function tradingSession(now = new Date()): TradingSession {
  const local = new Date(now.getTime() + 8 * 3600000);
  const date = local.toISOString().slice(0, 10);
  const ranges = holidays[local.getUTCFullYear()];
  const known = !!ranges;
  const weekday = local.getUTCDay();
  const day = date.slice(5);
  const tradingDay =
    known &&
    weekday !== 0 &&
    weekday !== 6 &&
    !ranges.some(([from, to]) => day >= from && day <= to);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60;
  const active =
    tradingDay && ((minute >= 570 && minute <= 690) || (minute >= 780 && minute <= 900));
  const label = !known
    ? "交易日历待更新"
    : !tradingDay
      ? "休市"
      : active
        ? "交易中"
        : minute > 690 && minute < 780
          ? "午间休市"
          : minute < 570
            ? "开盘前"
            : "已收盘";
  return { date, known, tradingDay, active, label };
}
