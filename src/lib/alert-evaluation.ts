import type { Quote } from "./types";
import type { AlertRule } from "./alert-types";
import { tradingSession } from "./trading-calendar";
/** 仅接受当日连续交易时段、两分钟内且未降级的有效行情。 */
export function validAlertQuote(quote: Quote, stale: boolean, now = new Date()) {
  const session = tradingSession(now);
  const at = Date.parse(`${quote.date}T${quote.time}+08:00`);
  return (
    session.active &&
    !stale &&
    quote.date === session.date &&
    Number.isFinite(at) &&
    tradingSession(new Date(at)).active &&
    at <= now.getTime() &&
    now.getTime() - at <= 120000 &&
    quote.price != null &&
    Number.isFinite(quote.price) &&
    quote.price > 0
  );
}
/** 只有严格位于阈值另一侧的基准向目标侧穿越才触发，首次采样不触发。 */
export function crossesThreshold(
  rule: Pick<AlertRule, "direction" | "threshold" | "previousValue">,
  value: number,
) {
  if (rule.previousValue == null || !Number.isFinite(value)) return false;
  return rule.direction === "above"
    ? rule.previousValue < rule.threshold && value >= rule.threshold
    : rule.previousValue > rule.threshold && value <= rule.threshold;
}
