import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultPortfolioColumns,
  exportPortfolioCsv,
  parsePortfolioCsv,
  portfolioImportRows,
} from "../../src/lib/portfolio-import";
import {
  calculatePortfolioRisk,
  defaultPortfolioRisk,
  validatePortfolioRisk,
} from "../../src/lib/portfolio-risk";
import { valuePortfolio } from "../../src/lib/portfolio-calculation";
import type { PortfolioTransaction } from "../../src/lib/portfolio-types";
import type { Quote } from "../../src/lib/types";

/** CSV 与仓位测试使用明确独立夹具，不请求真实行情。 */
function record(id: string, patch: Partial<PortfolioTransaction> = {}): PortfolioTransaction {
  return {
    id,
    sequence: Number(id),
    createdAt: 1,
    date: "2026-01-05",
    kind: "deposit",
    symbol: "",
    quantity: 0,
    price: 0,
    amount: 1000,
    fee: 0,
    note: "",
    ...patch,
  };
}

test("CSV备份正确往返特殊字符、公式文本、原前导单引号和稳定编号", () => {
  const records = ["=SUM(A1:A2)", "'+formula", '行一\n行二,"引号"', "\t@formula"].map(
    (note, index) => record(String(index + 1), { note }),
  );
  const text = exportPortfolioCsv(records),
    csv = parsePortfolioCsv(text),
    rows = portfolioImportRows(csv, defaultPortfolioColumns(csv.headers));
  assert.deepEqual(
    rows.map((row) => row.record?.note),
    records.map((row) => row.note),
  );
  assert.deepEqual(
    rows.map((row) => row.reference),
    ["1", "2", "3", "4"],
  );
  assert.ok(csv.rows.every((row) => row[7].startsWith("'")));
  assert.ok(rows.every((row) => !row.error));
});

test("普通CSV不擅自删备注前缀；逐行识别字段错误并保留相同合法行", () => {
  const csv = parsePortfolioCsv(
    "date,kind,amount,note\n2026-01-05,deposit,100,'=text\n2026-01-05,deposit,100,'=text\n2026-02-30,deposit,100,bad\n2026-01-05,deposit,=1+2,bad",
  );
  const rows = portfolioImportRows(csv, defaultPortfolioColumns(csv.headers));
  assert.equal(rows[0].record?.note, "'=text");
  assert.equal(rows[1].record?.amount, 100);
  assert.match(rows[2].error, /有效日期/);
  assert.match(rows[3].error, /非负数字/);
  const columns = defaultPortfolioColumns(csv.headers);
  columns.note = columns.amount;
  assert.throws(() => portfolioImportRows(csv, columns), /列映射/);
});

test("CSV限制引号、列数、行数与UTF8字节大小", () => {
  assert.throws(() => parsePortfolioCsv('a,b\n"unterminated'), /未闭合/);
  assert.throws(() => parsePortfolioCsv('a,b\n"x"bad,y'), /引号格式/);
  assert.throws(() => parsePortfolioCsv("a,b\nx"), /列数/);
  assert.throws(() => parsePortfolioCsv("a\n" + "x\n".repeat(1001)), /1000/);
  assert.throws(() => parsePortfolioCsv("a\n" + "中".repeat(400000)), /1 MB/);
});

test("风险用含现金总资产计算目标偏离和场景损失，未持有目标为零仓位", () => {
  const portfolio = valuePortfolio(
    [
      record("1", { amount: 10000 }),
      record("2", { kind: "buy", symbol: "sh600519", quantity: 100, price: 10, amount: 0 }),
    ],
    [
      {
        symbol: "sh600519",
        name: "夹具",
        date: "2026-01-05",
        time: "15:00:00",
        price: 20,
      } as Quote,
    ],
  );
  const settings = {
    stockLimit: 15,
    cashTarget: 60,
    assumedDrop: 10,
    targets: [
      { symbol: "sh600519", weight: 20 },
      { symbol: "sz000001", weight: 10 },
    ],
  };
  const risk = calculatePortfolioRisk(portfolio, settings);
  assert.ok(Math.abs(risk.rows[0].weight! - (2000 / 11000) * 100) < 1e-8);
  assert.equal(risk.rows[0].overLimit, true);
  assert.equal(risk.rows[1].weight, 0);
  assert.equal(risk.rows[1].deviation, -10);
  assert.equal(risk.unallocated, 10);
  assert.equal(risk.loss, 200);
  assert.equal(risk.afterDrop, 10800);
});

test("风险缺任一报价时不展示局部比例、超限判定或完整损失", () => {
  const portfolio = valuePortfolio(
    [
      record("1"),
      record("2", { kind: "buy", symbol: "sh600519", quantity: 10, price: 10, amount: 0 }),
    ],
    [],
  );
  const risk = calculatePortfolioRisk(portfolio, {
    ...defaultPortfolioRisk,
    stockLimit: 1,
    targets: [{ symbol: "sh600519", weight: 20 }],
  });
  assert.equal(risk.complete, false);
  assert.equal(risk.rows[0].weight, null);
  assert.equal(risk.rows[0].overLimit, null);
  assert.equal(risk.loss, null);
  assert.equal(risk.cashWeight, null);
  assert.throws(
    () =>
      validatePortfolioRisk({
        ...defaultPortfolioRisk,
        cashTarget: 80,
        targets: [{ symbol: "sh600519", weight: 30 }],
      }),
    /合计/,
  );
  assert.throws(
    () => validatePortfolioRisk({ ...defaultPortfolioRisk, assumedDrop: 0.123 }),
    /两位/,
  );
  assert.throws(
    () =>
      validatePortfolioRisk({
        ...defaultPortfolioRisk,
        targets: [{ symbol: "sh000001", weight: 10 }],
      }),
    /A 股/,
  );
});
