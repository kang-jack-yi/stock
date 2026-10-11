import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTechnical,
  parseTechnicalCandles,
  technicalSymbol,
  technicalDate,
} from "../../src/lib/technical-calculation";
import { evaluateSignal, signalWindow, validSignalClose } from "../../src/lib/signal-evaluation";
import type { Candle, Quote } from "../../src/lib/types";
import type { TechnicalPoint } from "../../src/lib/technical-types";

/** 简单可手算序列，仅供纯计算测试，不进入生产行情。 */
function bars(length: number, close: (i: number) => number): Candle[] {
  return Array.from({ length }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    open: close(i),
    close: close(i),
    high: close(i),
    low: close(i),
    volume: 100,
  }));
}
/** 真实公历和 A 股代码校验，指数/任意 URL/空白均拒绝。 */
test("技术数据代码与日期边界", () => {
  for (const symbol of ["sh600519", "sh688981", "sz000001", "sz300308", "bj920344"])
    assert.equal(technicalSymbol(symbol), true);
  for (const symbol of ["sh000001", "sz399001", "https://example.test", "sz000001 "])
    assert.equal(technicalSymbol(symbol), false);
  assert.equal(technicalDate("2024-02-29"), true);
  assert.equal(technicalDate("2026-02-29"), false);
});
/** 源乱序去重、越界日期过滤及逐市场单位；不能复制 AKShare 深主板单位误判。 */
test("腾讯解析复权口径、日期过滤与成交量单位", () => {
  const row = ["2026-10-09", "10", "11", "12", "9", "35111"];
  for (const symbol of ["sh600519", "sz000001", "sz300308", "sh688981", "bj920344"]) {
    const payload = {
      code: 0,
      data: {
        [symbol]: {
          qfqday: [row, row, ["2025-01-01", "1", "1", "1", "1", "1"]],
          day: [["2026-10-09", "20", "21", "22", "19", "35111"]],
        },
      },
    };
    const qfq = parseTechnicalCandles(payload, symbol, "qfq", "2026-01-01", "2026-10-11");
    assert.equal(qfq.length, 1);
    assert.equal(qfq[0].close, 11);
    assert.equal(qfq[0].volume, 35111 * (symbol.startsWith("sh68") ? 1 : 100));
    assert.equal(
      parseTechnicalCandles(payload, symbol, "none", "2026-01-01", "2026-10-11")[0].close,
      21,
    );
  }
  assert.throws(
    () => parseTechnicalCandles("var result={}", "sh600519", "qfq", "2026-01-01", "2026-10-11"),
    /返回异常/,
  );
  assert.throws(
    () =>
      parseTechnicalCandles(
        { code: 0, data: { sh600519: { day: [row, [...row.slice(0, 5), "-1"]] } } },
        "sh600519",
        "none",
        "2026-01-01",
        "2026-10-11",
      ),
    /成交量异常/,
  );
  assert.throws(
    () =>
      parseTechnicalCandles(
        { code: 0, data: { sh600519: { day: [row, [row[0], "10", "10.5", "12", "9", "35111"]] } } },
        "sh600519",
        "none",
        "2026-01-01",
        "2026-10-11",
      ),
    /冲突/,
  );
});
/** 平价序列 RSI50/BOLL 零标准差；暖机必须空值而不是补零。 */
test("技术指标暖机、平价 RSI 与布林总体标准差", () => {
  const points = calculateTechnical(bars(40, () => 100));
  assert.equal(points[12].rsi, null);
  assert.equal(points[14].rsi, 50);
  assert.equal(points[18].ma20, null);
  assert.equal(points[19].ma20, 100);
  assert.equal(points[19].upper, 100);
  assert.equal(points[19].lower, 100);
  assert.equal(points[24].dif, null);
  assert.equal(points[25].dif, 0);
  assert.equal(points[32].dea, null);
  assert.equal(points[33].dea, 0);
  assert.equal(points[33].macd, 0);
  assert.equal(points[4].volumeRatio, null);
  assert.equal(points[5].volumeRatio, 1);
});
/** 线性涨价序列 EMA 差可手算为 7，Wilder 全涨/全跌边界为 100/0。 */
test("MACD均值初始化与 RSI 单边边界", () => {
  const up = calculateTechnical(bars(40, (i) => 100 + i));
  assert.equal(up[19].ma20, 109.5);
  assert.equal(up[25].dif, 7);
  assert.equal(up[33].dea, 7);
  assert.equal(up[33].macd, 0);
  assert.equal(up[39].rsi, 100);
  const expected = Math.sqrt(33.25);
  assert.ok(Math.abs(up[19].upper! - (109.5 + 2 * expected)) < 1e-10);
  assert.equal(calculateTechnical(bars(40, (i) => 100 - i))[39].rsi, 0);
  assert.equal(
    calculateTechnical(bars(7, () => 100).map((row) => ({ ...row, volume: 0 })))[6].volumeRatio,
    null,
  );
});
/** 构造两个明确可交叉的指标观察点。 */
function points(): TechnicalPoint[] {
  const basic = calculateTechnical(bars(40, () => 100)).at(-1)!;
  return [
    {
      ...basic,
      date: "2026-10-08",
      close: 99,
      ma20: 100,
      dif: -1,
      dea: 0,
      rsi: 35,
      volumeRatio: 1,
    },
    {
      ...basic,
      date: "2026-10-09",
      close: 101,
      ma20: 100,
      dif: 1,
      dea: 0,
      rsi: 25,
      volumeRatio: 3,
    },
  ];
}
/** 跨越才触发，指标长期满足不会重复视为新事实，缺失暖机不采样。 */
test("四类技术条件交叉与缺失指标", () => {
  const [before, after] = points();
  for (const kind of ["ma20Above", "macdBullish", "volumeSpike", "rsiOversold"] as const) {
    assert.equal(evaluateSignal(kind, before, after).triggered, true);
    assert.equal(evaluateSignal(kind, after, after).triggered, false);
  }
  assert.equal(evaluateSignal("macdBullish", { ...before, dea: null }, after).ready, false);
});
/** 周末、未知年度、未收盘、缓存、错误日期/价及无交易量不生成信号。 */
test("收盘事实有效性与日历边界", () => {
  const quote = { symbol: "sh600519", date: "2026-10-09", time: "15:34:59", price: 101 } as Quote;
  const now = new Date("2026-10-09T16:00:00+08:00");
  assert.equal(signalWindow(now).allowed, true);
  assert.equal(validSignalClose(points(), quote, false, now), true);
  for (const patch of [
    { time: "14:59:59" },
    { time: "15:70:00" },
    { time: "17:00:00" },
    { date: "2026-10-08" },
    { price: 102 },
  ])
    assert.equal(validSignalClose(points(), { ...quote, ...patch }, false, now), false);
  assert.equal(validSignalClose(points(), quote, true, now), false);
  assert.equal(signalWindow(new Date("2026-10-11T16:00:00+08:00")).allowed, false);
  assert.equal(signalWindow(new Date("2027-01-05T16:00:00+08:00")).allowed, false);
  assert.equal(signalWindow(new Date("2026-10-09T15:04:59+08:00")).allowed, false);
});
