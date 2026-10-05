import { test } from "node:test";
import assert from "node:assert/strict";
import { marketBreadth, screenStocks, type ScreenerFilters } from "../../src/lib/screener";
import { compareCandles } from "../../src/lib/compare";
import { parseNews } from "../../src/lib/news";
import type { Candle, MarketStock } from "../../src/lib/types";

const filters: ScreenerFilters = {
  market: "all",
  query: "",
  profitable: false,
  excludeSt: false,
  sort: "amount",
  order: "desc",
  page: 1,
};
/** 创建单位明确的测试行，只覆盖本测试必须改变的值。 */
function stock(symbol: string, overrides: Partial<MarketStock> = {}): MarketStock {
  return {
    symbol,
    name: symbol,
    price: 10,
    change: 1,
    changePercent: 10,
    volume: 100,
    amount: 1000,
    pe: 10,
    pb: 1,
    turnover: 1,
    marketCap: 10000,
    floatCap: 8000,
    time: "15:00:00",
    ...overrides,
  };
}

test("条件筛选在完整集合上执行，再分页，最后一页中的匹配不会漏掉", () => {
  const rows = Array.from({ length: 45 }, (_, i) =>
    stock(`sh${String(600000 + i)}`, { amount: i + 1 }),
  );
  assert.equal(screenStocks(rows, { ...filters, query: "600044" }).total, 1);
  const second = screenStocks(rows, { ...filters, page: 2 });
  assert.equal(second.total, 45);
  assert.equal(second.stocks.length, 20);
  assert.equal(second.stocks[0].amount, 25);
});

test("边界包含零、PE缺失不当零值，正PE和ST条件分别生效", () => {
  const rows = [
    stock("sh600001", { pe: null }),
    stock("sz000001", { pe: 20 }),
    stock("sh600003", { pe: -2 }),
    stock("bj920001", { pe: 10, name: "*ST测试" }),
  ];
  assert.deepEqual(
    screenStocks(rows, { ...filters, minPe: 0, maxPe: 20, excludeSt: true }).stocks.map(
      (row) => row.symbol,
    ),
    ["sz000001"],
  );
  assert.equal(screenStocks(rows, { ...filters, profitable: true }).total, 2);
  assert.equal(screenStocks(rows, { ...filters, market: "bj" }).total, 1);
  assert.equal(
    screenStocks(rows, { ...filters, sort: "pe", order: "asc" }).stocks.at(-1)?.pe,
    null,
  );
  assert.equal(
    screenStocks(rows, { ...filters, sort: "pe", order: "desc" }).stocks.at(-1)?.pe,
    null,
  );
});

test("市场涨跌统计互斥守恒，价格缺失另计且不冒充平盘", () => {
  const rows = [
    stock("sh600001", { changePercent: -5 }),
    stock("sh600002", { changePercent: -2 }),
    stock("sh600003", { changePercent: 0 }),
    stock("sh600004", { changePercent: 2 }),
    stock("sh600005", { changePercent: 5 }),
    stock("sh600006", { price: null, changePercent: 0 }),
  ];
  const result = marketBreadth(rows, "2026-09-30T00:00:00Z");
  assert.equal(
    result.total,
    result.advancing + result.declining + result.unchanged + result.unavailable,
  );
  assert.deepEqual(result.distribution, [0, 1, 1, 1, 1, 1, 0]);
  assert.equal(result.amount, 6000);
  assert.equal(result.unavailable, 1);
});

/** 保留完整 OHLC 结构，让不同日期集合检验真正的交集而非位置对齐。 */
function candles(dates: string[], prices: number[]): Candle[] {
  return dates.map((date, i) => ({
    date,
    open: prices[i],
    close: prices[i],
    high: prices[i],
    low: prices[i],
    volume: 100,
  }));
}

test("股票比较按共同交易日归一，不用不同上市日期作为各自基准", () => {
  const dates = ["2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29"];
  const result = compareCandles(
    [
      { symbol: "sh600001", name: "A", candles: candles(dates, [5, 10, 20, 15]) },
      { symbol: "sz000001", name: "B", candles: candles(dates.slice(1), [100, 120, 110]) },
    ],
    20,
  );
  assert.deepEqual(result.dates, dates.slice(1));
  assert.deepEqual(result.series[0].returns, [0, 100, 50]);
  assert.equal(result.series[0].maxDrawdown, -25);
  assert.ok(Math.abs(result.series[1].totalReturn - 10) < 1e-10);
  assert.equal(result.series[0].averageVolume, 100);
});

test("没有两个有效共同日期时不能伪造比较；零收盘价不参与基准", () => {
  assert.throws(
    () =>
      compareCandles(
        [
          { symbol: "A", name: "A", candles: candles(["2026-09-28", "2026-09-29"], [0, 10]) },
          { symbol: "B", name: "B", candles: candles(["2026-09-28", "2026-09-29"], [20, 30]) },
        ],
        20,
      ),
    /共同交易日不足/,
  );
});

test("资讯解析只保留安全原文链接和有效日期，标题不作为HTML执行", () => {
  const item = {
    docid: "news1",
    title: "<b>财经</b>测试",
    url: "https://finance.sina.com.cn/stock/test.shtml",
    ctime: 1790767000,
    media_name: "新浪财经",
  };
  const source = JSON.stringify({
    result: {
      status: { code: 0 },
      total: 5,
      data: [
        item,
        item,
        { ...item, docid: "script", url: "javascript:alert(1)" },
        { ...item, docid: "foreign", url: "https://sina.com.cn.evil.example/a" },
        { ...item, docid: "bad-date", ctime: "no-date" },
      ],
    },
  });
  const result = parseNews(source, "stocks");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "财经测试");
  assert.equal(result.items[0].publishedAt, new Date(1790767000000).toISOString());
  assert.throws(
    () => parseNews('{"result":{"status":{"code":11},"data":[]}}', "stocks"),
    /暂不可用/,
  );
});
