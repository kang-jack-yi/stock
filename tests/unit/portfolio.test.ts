import { test } from "node:test";
import assert from "node:assert/strict";
import {
  portfolioToday,
  replayPortfolio,
  validatePortfolioInput,
  valuePortfolio,
} from "../../src/lib/portfolio-calculation";
import type { PortfolioTransaction } from "../../src/lib/portfolio-types";
import type { Quote } from "../../src/lib/types";

/** 生成确定性账本记录，允许用补丁表达不同业务。 */
function record(sequence: number, patch: Partial<PortfolioTransaction>): PortfolioTransaction {
  return {
    id: String(sequence),
    sequence,
    createdAt: sequence,
    date: "2026-01-05",
    kind: "deposit",
    symbol: "",
    quantity: 0,
    price: 0,
    amount: 0,
    fee: 0,
    note: "",
    ...patch,
  };
}
/** 最小可估值报价；仅估值所需字段参与计算。 */
function quote(symbol: string, price: number | null, date = "2026-01-05") {
  return { symbol, price, date, time: "15:00:00", name: symbol } as Quote;
}
const funded = record(1, { amount: 10000 });
const bought = record(2, { kind: "buy", symbol: "sh600519", quantity: 100, price: 10, fee: 5 });

test("加权成本含买卖费用、现金分红、送转股及清仓实现收益", () => {
  const records = [
    funded,
    bought,
    record(3, { kind: "buy", symbol: "sh600519", quantity: 100, price: 20, fee: 5 }),
    record(4, { kind: "sell", symbol: "sh600519", quantity: 100, price: 18, fee: 5 }),
    record(5, { kind: "dividend", symbol: "sh600519", amount: 50 }),
    record(6, { kind: "bonus", symbol: "sh600519", quantity: 100 }),
  ];
  const result = valuePortfolio(records, [quote("sh600519", 9)]);
  assert.equal(result.cash, 8835);
  assert.equal(result.cost, 1505);
  assert.equal(result.realized, 340);
  assert.equal(result.holdings[0].quantity, 200);
  assert.equal(result.holdings[0].averageCost, 7.525);
  assert.equal(result.unrealized, 295);
  assert.equal(result.totalProfit, 635);
  assert.equal(result.holdings[0].concentration, 100);
  records.push(record(7, { kind: "sell", symbol: "sh600519", quantity: 200, price: 9, fee: 5 }));
  const closed = valuePortfolio(records, []);
  assert.equal(closed.cost, 0);
  assert.equal(closed.realized, 630);
  assert.equal(closed.totalProfit, 630);
  assert.equal(closed.holdings[0].contribution, 630);
});

test("任何历史节点超卖、负现金、无持仓送转股都拒绝", () => {
  assert.throws(() => replayPortfolio([bought]), /现金余额不足/);
  assert.throws(
    () =>
      replayPortfolio([
        funded,
        bought,
        record(3, { kind: "sell", symbol: "sh600519", quantity: 101, price: 20 }),
      ]),
    /超过当时持仓/,
  );
  assert.throws(
    () => replayPortfolio([funded, record(2, { kind: "bonus", symbol: "sh600519", quantity: 1 })]),
    /必须有持仓/,
  );
  assert.throws(
    () =>
      replayPortfolio([
        funded,
        bought,
        record(3, { kind: "withdraw", amount: 9500 }),
        record(4, { amount: 9500 }),
      ]),
    /现金余额不足/,
  );
});

test("按日期和稳定序号回放而非输入顺序，未来入金不能弥补历史缺口", () => {
  assert.equal(replayPortfolio([bought, funded]).cash, 8995);
  assert.throws(() => replayPortfolio([{ ...funded, date: "2026-01-06" }, bought]), /现金余额不足/);
});

test("现金出入不算收益，缺失/过早/未来报价不当零估值", () => {
  const records = [funded, bought, record(3, { kind: "withdraw", amount: 1000 })];
  const missing = valuePortfolio(records, []);
  assert.equal(missing.netDeposits, 9000);
  assert.equal(missing.cash, 7995);
  assert.equal(missing.marketValue, null);
  assert.equal(missing.totalAssets, null);
  assert.equal(missing.unrealized, null);
  assert.equal(missing.totalProfit, null);
  assert.deepEqual(missing.missingSymbols, ["sh600519"]);
  assert.equal(valuePortfolio(records, [quote("sh600519", 10, "2026-01-04")]).totalAssets, null);
  assert.equal(valuePortfolio(records, [quote("sh600519", 10, "2099-01-01")]).totalAssets, null);
  assert.equal(valuePortfolio(records, [quote("sh600519", 10)]).totalProfit, -5);
  assert.equal(valuePortfolio(records, [quote("sh600519", Infinity)]).totalAssets, null);
  assert.equal(valuePortfolio(records, [quote("sh600519", 10, "2026-02-30")]).totalAssets, null);
  assert.equal(
    valuePortfolio(records, [{ ...quote("sh600519", 10), time: "25:00:00" }]).totalAssets,
    null,
  );
});

test("部分行情只累加已定价市值，完整组合与集中度仍缺失", () => {
  const records = [
    funded,
    bought,
    record(3, { kind: "buy", symbol: "sz000001", quantity: 100, price: 10 }),
  ];
  const result = valuePortfolio(records, [quote("sh600519", 12)]);
  assert.equal(result.knownMarketValue, 1200);
  assert.equal(result.marketValue, null);
  assert.equal(result.holdings[0].unrealized, 195);
  assert.equal(result.holdings[0].concentration, null);
  assert.equal(result.holdings[1].marketValue, null);
});

test("输入拒绝指数、未来/无效日期、小数股数、非有限金额及错误业务字段", () => {
  for (const patch of [
    { symbol: "sh000001" },
    { date: "2099-01-01" },
    { date: "2026-02-30" },
    { quantity: 1.5 },
    { price: Infinity },
    { price: 1.001 },
    { amount: 10 },
  ])
    assert.throws(() => validatePortfolioInput({ ...bought, ...patch }));
  assert.throws(() => validatePortfolioInput({ ...funded, symbol: "sh600519" }));
  assert.equal(portfolioToday(new Date("2026-01-05T16:01:00Z")), "2026-01-06");
});

test("最多60证券与分币结转不残留成本", () => {
  const records = [record(1, { amount: 1e6 })];
  for (let index = 0; index < 61; index++)
    records.push(
      record(index + 2, {
        kind: "buy",
        symbol: `sh60${index.toString().padStart(4, "0")}`,
        quantity: 1,
        price: 1,
      }),
    );
  assert.throws(() => replayPortfolio(records), /60 个证券/);
  const result = replayPortfolio([
    funded,
    { ...bought, quantity: 3, price: 0.1, fee: 0 },
    record(3, { kind: "sell", symbol: "sh600519", quantity: 1, price: 0.1 }),
    record(4, { kind: "sell", symbol: "sh600519", quantity: 2, price: 0.1 }),
  ]);
  assert.equal(result.positions[0].cost, 0);
  assert.equal(result.cash, 10000);
});
