import assert from "node:assert/strict";
import test from "node:test";
import { parseSectorSummary, sortSectorStocks } from "../../src/lib/sina/sector-parse";
import { parseMarket } from "../../src/lib/sina/parse";

test("行业汇总保留股、元、百分比数值和平均股价的独立口径", () => {
  const text =
    'var S_Finance_bankuai_sinaindustry = {"new_blhy":"new_blhy,玻璃行业,19,16.733157894737,0.0010526315789474,0.0062910886728949,410050588,9066360698,sz300395,2.395,94.920,2.220,菲利华"}';
  const [sector] = parseSectorSummary(text, "industry");
  assert.equal(sector.reportedStockCount, 19);
  assert.equal(sector.averagePrice, 16.733157894737);
  assert.equal(sector.changePercent, 0.0062910886728949);
  assert.equal(sector.volume, 410050588);
  assert.equal(sector.amount, 9066360698);
  assert.equal(sector.leaderSymbol, "sz300395");
});

test("概念节点允许大小写，缺失指标不填零，真实零涨跌保留", () => {
  const [sector] = parseSectorSummary(
    'var S_Finance_bankuai_class = {"gn_BCdc":"gn_BCdc,BC电池,26,,0,0,--,-1,none,,0,,"};',
    "concept",
  );
  assert.equal(sector.kind, "concept");
  assert.equal(sector.id, "gn_BCdc");
  assert.equal(sector.change, 0);
  assert.equal(sector.changePercent, 0);
  assert.equal(sector.averagePrice, null);
  assert.equal(sector.volume, null);
  assert.equal(sector.amount, null);
  assert.equal(sector.leaderSymbol, null);
  assert.equal(sector.leaderName, null);
});

test("拒绝带额外 JavaScript 的包装、错误分类和不完整数据，绝不执行脚本", () => {
  const valid =
    'var S_Finance_bankuai_class = {"gn_hwqc":"gn_hwqc,华为汽车,97,23.95,-0.28,-1.18,2069201242,31890354954,sz002454,10,5.61,0.51,松芝股份"}';
  assert.throws(() => parseSectorSummary(valid + "; globalThis.untrusted = true;", "concept"));
  assert.throws(() => parseSectorSummary(valid, "industry"));
  assert.throws(() =>
    parseSectorSummary('var S_Finance_bankuai_class={"gn_hwqc":"missing"}', "concept"),
  );
  assert.throws(() => parseSectorSummary("var S_Finance_bankuai_class={}", "concept"));
});

test("对完整成分按规范化金额排序，空值始终排最后且不修改原快照", () => {
  const stocks = parseMarket(
    JSON.stringify([
      { symbol: "sh600001", name: "股票一", trade: "20", changepercent: "--", amount: 100 },
      { symbol: "sh600002", name: "股票二", trade: "10", changepercent: 0, amount: 300 },
      { symbol: "sh600003", name: "股票三", trade: "15", changepercent: -2, amount: 200 },
    ]),
  );
  assert.deepEqual(
    sortSectorStocks(stocks, "amount", false).map((row) => row.symbol),
    ["sh600002", "sh600003", "sh600001"],
  );
  assert.deepEqual(
    sortSectorStocks(stocks, "changepercent", true).map((row) => row.symbol),
    ["sh600003", "sh600002", "sh600001"],
  );
  assert.equal(stocks[0].symbol, "sh600001");
});
