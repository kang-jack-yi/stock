import test from "node:test";
import assert from "node:assert/strict";
import {
  alignedReviewStock,
  compareReviewScreeners,
  compareReviewSectors,
  reviewCaptureWindow,
  reviewConditionKey,
  reviewMatches,
  reviewQuoteIssue,
  validReviewMeta,
} from "../../src/lib/review-compare";
import type { MarketStock, Quote } from "../../src/lib/types";
import type { ScreenerFilters } from "../../src/lib/screener";
import type { ReviewScreener } from "../../src/lib/review-types";
import type { SectorSummary } from "../../src/lib/sector-types";

const filters: ScreenerFilters = {
  market: "all",
  query: "",
  profitable: false,
  excludeSt: false,
  sort: "amount",
  order: "desc",
  page: 1,
};
/** 明确为单元测试的行情夹具，不请求或写入生产行情。 */
function stock(index: number): MarketStock {
  return {
    symbol: `sz${String(index).padStart(6, "0")}`,
    name: `测试证券${index}`,
    price: 10,
    change: 1,
    changePercent: 11.11,
    volume: 100,
    amount: 1000,
    pe: 10,
    pb: 1,
    marketCap: 1e8,
    floatCap: 1e8,
    turnover: 1,
    time: "15:00:00",
  };
}
/** 收盘日期验证的独立测试夹具。 */
function quote(patch: Partial<Quote> = {}): Quote {
  return {
    ...stock(1),
    previousClose: 9,
    open: 9,
    high: 10,
    low: 9,
    date: "2026-10-09",
    status: "00",
    bids: [],
    asks: [],
    totalShares: 1e7,
    floatShares: 1e7,
    amplitude: 1,
    ...patch,
  };
}

test("复盘只允许已核实交易日15:05以后；节假日、周末、未知年和盘中拒绝", () => {
  for (const at of [
    "2026-10-09T15:04:59+08:00",
    "2026-10-01T16:00:00+08:00",
    "2026-10-10T16:00:00+08:00",
    "2027-10-08T16:00:00+08:00",
  ])
    assert.equal(reviewCaptureWindow(new Date(at)).allowed, false);
  assert.equal(reviewCaptureWindow(new Date("2026-10-09T15:05:00+08:00")).allowed, true);
  assert.equal(reviewCaptureWindow(new Date("2026-10-09T23:59:59+08:00")).date, "2026-10-09");
});
test("收盘缓存拒绝盘中、跨日、未来与降级；真实证券日期不能用请求日填充", () => {
  const now = new Date("2026-10-09T16:00:00+08:00");
  const meta = { source: "测试", fetchedAt: "2026-10-09T15:10:00+08:00", stale: false };
  assert.equal(validReviewMeta(meta, "2026-10-09", now), true);
  for (const patch of [
    { stale: true },
    { fetchedAt: "2026-10-09T14:59:59+08:00" },
    { fetchedAt: "2026-10-08T16:00:00+08:00" },
    { fetchedAt: "2026-10-09T16:02:00+08:00" },
    { fetchedAt: "unknown" },
  ])
    assert.equal(validReviewMeta({ ...meta, ...patch }, "2026-10-09", now), false);
  assert.equal(reviewQuoteIssue(quote(), "2026-10-09"), null);
  for (const patch of [
    { date: "2026-10-08" },
    { date: "" },
    { time: "14:59:59" },
    { time: "15:99:99" },
    { time: "24:00:00" },
    { price: 0 },
    { price: NaN },
    { changePercent: null },
  ])
    assert.ok(reviewQuoteIssue(quote(patch), "2026-10-09"));
  assert.ok(reviewQuoteIssue(undefined, "2026-10-09"));
  assert.equal(alignedReviewStock(stock(1), quote({ changePercent: 11.1111 })), true);
  assert.equal(alignedReviewStock(stock(1), quote({ price: 10.02 })), false);
});
test("匹配集覆盖全部证券，不能受默认20条分页影响；条件键忽略排序并保持数值条件", () => {
  const stocks = Array.from({ length: 65 }, (_, index) => stock(index));
  assert.equal(reviewMatches(stocks, filters).length, 65);
  assert.equal(reviewMatches(stocks, { ...filters, minPrice: 11 }).length, 0);
  assert.equal(
    reviewConditionKey(filters),
    reviewConditionKey({ ...filters, sort: "pe", order: "asc" }),
  );
  assert.notEqual(reviewConditionKey(filters), reviewConditionKey({ ...filters, minPrice: 10 }));
});
test("同条件相邻快照计算完整新增退出，条件变化和首次无基线；缺失报价不假报退出", () => {
  const before: ReviewScreener = {
    id: "a",
    name: "方案",
    conditionHash: "same",
    matches: reviewMatches([stock(1), stock(2)], filters),
  };
  const current = { ...before, matches: reviewMatches([stock(2), stock(3)], filters) };
  const result = compareReviewScreeners([current], [before])[0];
  assert.equal(result.hasBaseline, true);
  assert.deepEqual(
    result.added.map((row) => row.symbol),
    [stock(3).symbol],
  );
  assert.deepEqual(
    result.removed.map((row) => row.symbol),
    [stock(1).symbol],
  );
  assert.equal(compareReviewScreeners([current])[0].hasBaseline, false);
  const modified = compareReviewScreeners([{ ...current, conditionHash: "changed" }], [before])[0];
  assert.equal(modified.hasBaseline, false);
  assert.deepEqual(modified.added, []);
  assert.deepEqual(modified.removed, []);
  const incomplete = compareReviewScreeners(
    [current],
    [before],
    [stock(1).symbol],
    [stock(3).symbol],
  )[0];
  assert.deepEqual(incomplete.added, []);
  assert.deepEqual(incomplete.removed, []);
  assert.equal(incomplete.unverifiable.length, 2);
});
test("板块变化严格按分类和编号配对，缺失基线不能填零", () => {
  const industry = { id: "test", kind: "industry", changePercent: 2 } as SectorSummary;
  const concept = { id: "test", kind: "concept", changePercent: 1 } as SectorSummary;
  assert.equal(compareReviewSectors([industry], [concept])[0].difference, null);
  assert.equal(
    compareReviewSectors([industry], [{ ...industry, changePercent: -1 }])[0].difference,
    3,
  );
  assert.equal(
    compareReviewSectors([{ ...industry, changePercent: null }], [industry])[0].difference,
    null,
  );
});
