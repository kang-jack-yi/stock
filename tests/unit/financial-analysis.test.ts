import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeFinancials,
  quarterlyValues,
  sameQuarterYoy,
} from "../../src/lib/financial-analysis";
import type { Financials } from "../../src/lib/types";

/** 构造按字段代码和报告日期对齐的财务样本。 */
function report(dates: string[], rows: Record<string, (number | null)[]>): Financials {
  return {
    symbol: "sh600519",
    source: "gjzb",
    dates,
    currency: "CNY",
    publishedAt: "",
    rows: Object.entries(rows).map(([field, values]) => ({
      field: `${field}|测试指标`,
      title: "测试指标",
      values,
      heading: false,
      unit: "元",
      yoy: null,
    })),
  };
}

test("季度差分按日期寻找相邻同年报告，不依赖排序、不跨年或跳期", () => {
  assert.deepEqual(
    quarterlyValues(
      ["20260930", "20260331", "20260630", "20251231", "20250930", "20250630", "20250331"],
      [360, 100, 220, 400, 290, 180, 80],
    ),
    [140, 100, 120, 110, 110, 100, 80],
  );
  assert.deepEqual(quarterlyValues(["20260930", "20260331", "20251231"], [360, 100, 400]), [
    null,
    100,
    null,
  ]);
  assert.deepEqual(quarterlyValues(["20260430", "20260331", "20260630"], [120, null, 220]), [
    null,
    null,
    null,
  ]);
});

test("同季度同比保留负数改善，缺少去年同季度或零基数不生成百分比", () => {
  assert.deepEqual(sameQuarterYoy(["20260630", "20250630"], [-20, -40]), [50, null]);
  assert.deepEqual(sameQuarterYoy(["20260630", "20250630"], [20, 0]), [null, null]);
  assert.deepEqual(sameQuarterYoy(["20260630", "20250331"], [20, 10]), [null, null]);
});

test("单季度分析只差分流量，净利率使用净利润和营业收入而不是归母与总收入", () => {
  const dates = ["20260630", "20260331", "20250630", "20250331"];
  const key = report(dates, {
    BIZTOTINCO: [250, 100, 200, 80],
    PARENETP: [60, 20, 40, 15],
    MANANETR: [80, 30, 50, 20],
    ASSLIABRT: [30, 28, 26, 25],
    SNPMARGINCONMS: [25, 20, 18, 15],
    EPSBASIC: [2, 1, 1.5, 0.5],
  });
  const income = report(["20250331", "20260630", "20250630", "20260331"], {
    NETPROFIT: [20, 90, 50, 30],
    BIZINCO: [80, 200, 160, 80],
  });
  const result = analyzeFinancials(key, income, "quarter");
  assert.deepEqual(result.revenue, [150, 100, 120, 80]);
  assert.deepEqual(result.netMargin, [50, 37.5, 37.5, 25]);
  assert.deepEqual(result.debtRatio, [30, 28, 26, 25]);
  assert.deepEqual(result.revenueYoy, [25, 25, null, null]);
  assert.equal(result.profitYoy[0], 60);
  assert.deepEqual(
    key.rows.find((row) => row.field.startsWith("EPSBASIC"))?.values,
    [2, 1, 1.5, 0.5],
  );
});

test("累计比率沿用报告原值；单季度利润表不完整及零收入都显示缺失", () => {
  const key = report(["20260630", "20260331"], { SNPMARGINCONMS: [25, 20] });
  assert.deepEqual(analyzeFinancials(key, undefined, "cumulative").netMargin, [25, 20]);
  assert.deepEqual(analyzeFinancials(key, undefined, "quarter").netMargin, [null, null]);
  const income = report(["20260630"], { NETPROFIT: [90], BIZINCO: [200] });
  assert.deepEqual(analyzeFinancials(key, income, "quarter").netMargin, [null, null]);
  const zero = report(["20260630", "20260331"], { NETPROFIT: [90, 30], BIZINCO: [80, 80] });
  assert.equal(analyzeFinancials(key, zero, "quarter").netMargin[0], null);
});

test("银行关键指标采用已核实的替代字段，零流量仍保留为零", () => {
  const bank = report(["20260630", "20260331"], {
    BIZINCO: [200, 100],
    NETPARECOMPPROF: [20, 20],
    MANANETR: [0, 0],
  });
  const result = analyzeFinancials(bank, undefined, "quarter");
  assert.deepEqual(result.revenue, [100, 100]);
  assert.deepEqual(result.profit, [0, 20]);
  assert.deepEqual(result.cashFlow, [0, 0]);
});
