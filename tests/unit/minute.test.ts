import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeMinute, parseMinutes } from "../../src/lib/sina/minute";

test("实测分时样本解出交易日、价格、均价和 241 个正确时间点", () => {
  const encoded = readFileSync(
    new URL("../fixtures/minute-20260930.txt", import.meta.url),
    "utf8",
  ).trim();
  const result = decodeMinute(encoded);
  assert.equal(result.date, "2026-09-30");
  assert.equal(result.previousClose, 1235.58);
  assert.equal(result.points.length, 241);
  assert.equal(result.points[0].time, "09:30");
  assert.equal(result.points[0].price, 1239.53);
  assert.equal(result.points[121].time, "13:01");
  assert.equal(result.points[240].time, "15:00");
  assert.equal(result.points[240].price, 1258.62);
  assert.equal(result.points[240].average, 1251.556);
  assert.equal(result.points[240].volume, 64355);
});
test("空数据和不支持的编码明确报错", () => {
  assert.throws(() => parseMinutes('var KLC_ML="";'));
  assert.throws(() => decodeMinute("invalid!"));
});
