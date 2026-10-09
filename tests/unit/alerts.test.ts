import { test } from "node:test";
import assert from "node:assert/strict";
import { crossesThreshold, validAlertQuote } from "../../src/lib/alert-evaluation";
import { tradingSession } from "../../src/lib/trading-calendar";
import type { Quote } from "../../src/lib/types";

/** 时区、节假日与调休周末必须与交易所日历一致。 */
test("交易日历区分国庆、普通交易日、调休周六、午休和未知年份", () => {
  assert.equal(tradingSession(new Date("2026-10-05T10:00:00+08:00")).active, false);
  assert.equal(tradingSession(new Date("2026-10-09T10:00:00+08:00")).active, true);
  assert.equal(tradingSession(new Date("2026-10-10T10:00:00+08:00")).tradingDay, false);
  assert.equal(tradingSession(new Date("2026-10-09T12:00:00+08:00")).label, "午间休市");
  assert.equal(tradingSession(new Date("2026-10-09T08:00:00+08:00")).label, "开盘前");
  assert.equal(tradingSession(new Date("2026-10-09T15:01:00+08:00")).label, "已收盘");
  assert.equal(tradingSession(new Date("2026-10-09T11:30:01+08:00")).active, false);
  assert.equal(tradingSession(new Date("2026-10-09T15:00:01+08:00")).active, false);
  assert.equal(tradingSession(new Date("2027-01-04T10:00:00+08:00")).known, false);
  assert.equal(tradingSession(new Date("2026-10-08T17:00:00Z")).date, "2026-10-09");
});
/** 冷启动、相等边界与反向波动不能冒充阈值穿越。 */
test("提醒首次采样不触发，只有上穿/下穿才触发", () => {
  const rule = {
    direction: "above" as const,
    threshold: 100,
    previousValue: null as number | null,
  };
  assert.equal(crossesThreshold(rule, 101), false);
  assert.equal(crossesThreshold({ ...rule, previousValue: 99 }, 100), true);
  assert.equal(crossesThreshold({ ...rule, previousValue: 101 }, 102), false);
  assert.equal(crossesThreshold({ ...rule, previousValue: 100 }, 101), false);
  assert.equal(crossesThreshold({ ...rule, direction: "below", previousValue: 101 }, 100), true);
  assert.equal(crossesThreshold({ ...rule, previousValue: 99 }, NaN), false);
});
/** 旧日期、陈旧缓存、未来时间、无效价格和休市数据一律拒绝。 */
test("提醒只接受当日两分钟内有效行情", () => {
  const now = new Date("2026-10-09T10:00:00+08:00");
  const quote = { date: "2026-10-09", time: "09:59:00", price: 100 } as Quote;
  assert.equal(validAlertQuote(quote, false, now), true);
  assert.equal(validAlertQuote(quote, true, now), false);
  assert.equal(validAlertQuote({ ...quote, date: "2026-10-08" }, false, now), false);
  assert.equal(validAlertQuote({ ...quote, time: "09:57:00" }, false, now), false);
  assert.equal(validAlertQuote({ ...quote, time: "10:01:00" }, false, now), false);
  assert.equal(validAlertQuote({ ...quote, price: null }, false, now), false);
  assert.equal(validAlertQuote({ ...quote, price: 0 }, false, now), false);
  assert.equal(
    validAlertQuote({ ...quote, time: "09:29:59" }, false, new Date("2026-10-09T09:30:30+08:00")),
    false,
  );
  assert.equal(validAlertQuote(quote, false, new Date("2026-10-05T10:00:00+08:00")), false);
});
