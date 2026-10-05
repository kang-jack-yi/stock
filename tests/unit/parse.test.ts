import { test } from "node:test";
import assert from "node:assert/strict";
import {
  numeric,
  parseCandles,
  parseFinancials,
  parseFunds,
  parseMarket,
  parseQuotes,
  parseSearch,
  validSymbol,
} from "../../src/lib/sina/parse";

test("空值与零值保持不同，外部 URL 不被当作股票代码", () => {
  assert.equal(numeric(""), null);
  assert.equal(numeric("--"), null);
  assert.equal(numeric("0"), 0);
  assert.throws(() => validSymbol("https://example.com"));
  assert.equal(validSymbol("sh600519"), "sh600519");
});
test("行情兼容尾部新增字段，股本从万股转换为股并派生 PE TTM", () => {
  const fields = [
    "测试公司",
    "10",
    "10",
    "11",
    "12",
    "9",
    "11",
    "11.1",
    "100000",
    "1100000",
    ...Array.from({ length: 10 }, (_, i) => [String(100 + i), "11"]).flat(),
    "2026-09-30",
    "15:00:00",
    "00",
    "new-field",
  ];
  const text = `var hq_str_sh600519="${fields.join(",")}";\nvar hq_str_sh600519_i="A,cs,1,2,1,5,0,1000,500";`;
  const quote = parseQuotes(text, ["sh600519"])[0];
  assert.equal(quote.name, "测试公司");
  assert.equal(quote.changePercent, 10);
  assert.equal(quote.volume, 100000);
  assert.equal(quote.totalShares, 10000000);
  assert.equal(quote.marketCap, 110000000);
  assert.equal(quote.turnover, 2);
  assert.equal(quote.pe, 5.5);
  assert.equal(quote.pb, 2.2);
  assert.equal(quote.bids.length, 5);
  assert.equal(quote.asks.length, 5);
  assert.deepEqual(parseQuotes('var hq_str_sh600519="";', ["sh600519"]), []);
});
test("列表市值从万元转换为元，缺少 PE 不伪装成零", () => {
  const result = parseMarket(
    JSON.stringify([
      { symbol: "sh600519", name: "茅台", trade: "10", mktcap: 5000, nmc: 3000, per: "--" },
    ]),
  );
  assert.equal(result[0].marketCap, 50000000);
  assert.equal(result[0].floatCap, 30000000);
  assert.equal(result[0].pe, null);
});
test("搜索只返回沪深代码，并去重", () => {
  const result = parseSearch(
    'var suggestdata="sh600519,11,600519,sh600519,贵州茅台;sh600519,11,600519,sh600519,贵州茅台;hk00700,31,00700,hk00700,腾讯";',
  );
  assert.deepEqual(result, [{ symbol: "sh600519", name: "贵州茅台", code: "600519" }]);
});
test("K线拒绝 null 和非法数值，不生成伪造的蜡烛", () => {
  assert.throws(() => parseCandles("null"));
  assert.equal(
    parseCandles(
      '[{"day":"2026-09-30","open":"10","close":"11","high":"12","low":"9","volume":"100"}]',
    )[0].volume,
    100,
  );
  assert.deepEqual(parseCandles('[{"day":"2026-09-30","open":null}]'), []);
});
test("资金流解析仅接受数据，不执行 JS 包装中的代码", () => {
  const result = parseFunds(
    '/* ignored */ var data=({"opendate":"2026-09-30","ticktime":"15:00:00","r0_in":"100","r0_out":"25","r1_in":"20","r1_out":"30"});',
    "sh600519",
  );
  assert.equal(result.net, 65);
  assert.equal(result.categories[0].net, 75);
  assert.throws(() => parseFunds("alert('not data')", "sh600519"));
});
test("报表空字段为 null；原始百分比和同比小数比例不混淆", () => {
  const item = {
    item_field: "ROE",
    item_title: "净资产收益率",
    item_value: "16.75",
    item_precision: "p2",
    item_tongbi: "-0.06372",
  };
  const text = JSON.stringify({
    result: {
      status: { code: 0 },
      data: {
        report_date: [{ date_value: "20260630" }, { date_value: "20260331" }],
        report_list: {
          "20260630": { data: [item] },
          "20260331": { data: [{ ...item, item_value: null }] },
        },
      },
    },
  });
  const row = parseFinancials(text, "sh600519", "gjzb").rows[0];
  assert.equal(row.unit, "%");
  assert.deepEqual(row.values, [16.75, null]);
  assert.equal(row.yoy, -0.06372);
});
