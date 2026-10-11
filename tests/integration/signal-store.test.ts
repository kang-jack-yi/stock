import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import {
  createSignal,
  getSignals,
  markSignalRead,
  recordSignalObservation,
  signalLease,
  updateSignal,
} from "../../src/lib/signals";
import { calculateTechnical } from "../../src/lib/technical-calculation";
import type { Quote } from "../../src/lib/types";

process.env.DATABASE_PATH = "./data/signals-integration.db";
/** 专用数据库随机账号，清理仅限本次测试实体。 */
async function accounts(run: (first: string, second: string) => void) {
  const ids = [randomUUID(), randomUUID()];
  try {
    for (const id of ids)
      db()
        .prepare("INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)")
        .run(id, `${id}@integration.test`, "技术测试", "test-only", Date.now());
    run(ids[0], ids[1]);
  } finally {
    for (const id of ids) db().prepare("DELETE FROM users WHERE id=?").run(id);
  }
}
/** 只有已关注股票允许采样；夹具显式构造跨越，并非伪造生产日线。 */
function fixture() {
  const point = calculateTechnical([
    { date: "2026-10-08", open: 99, close: 99, high: 99, low: 99, volume: 100 },
  ])[0];
  return [
    { ...point, date: "2026-10-08", ma20: 100 },
    { ...point, date: "2026-10-09", open: 101, high: 101, low: 101, close: 101, ma20: 100 },
  ];
}
const now = new Date("2026-10-09T16:00:00+08:00");
const quote = {
  symbol: "sh600519",
  name: "技术信号测试夹具",
  price: 101,
  date: "2026-10-09",
  time: "15:34:59",
} as Quote;

test("技术订阅账号隔离、关注范围、每日去重与保留历史", async () =>
  accounts((first, second) => {
    assert.throws(() => createSignal(first, quote.symbol, "ma20Above"), /先将股票/);
    db()
      .prepare("INSERT INTO watchlist(user_id,symbol,created_at) VALUES(?,?,?)")
      .run(first, quote.symbol, Date.now());
    createSignal(first, quote.symbol, "ma20Above");
    assert.throws(() => createSignal(first, quote.symbol, "ma20Above"), /已订阅/);
    const rule = getSignals(first).rules[0];
    assert.deepEqual(recordSignalObservation(rule.id, fixture(), quote, now), {
      checked: 1,
      triggered: 1,
    });
    assert.deepEqual(recordSignalObservation(rule.id, fixture(), quote, now), {
      checked: 0,
      triggered: 0,
    });
    updateSignal(first, rule.id, false);
    updateSignal(first, rule.id, true);
    assert.equal(recordSignalObservation(rule.id, fixture(), quote, now).triggered, 0);
    assert.equal(getSignals(first).events.length, 1);
    assert.equal(getSignals(second).events.length, 0);
    assert.throws(() => updateSignal(second, rule.id), /不存在/);
    const event = getSignals(first).events[0];
    assert.throws(() => markSignalRead(second, event.id), /不存在/);
    markSignalRead(first, event.id);
    assert.equal(getSignals(first).events[0].read, true);
    updateSignal(first, rule.id);
    assert.equal(getSignals(first).events[0].ruleId, null);
  }));
test("无效收盘、缓存、取消关注和租约旧所有者不会写入", async () =>
  accounts((first) => {
    db()
      .prepare("INSERT INTO watchlist(user_id,symbol,created_at) VALUES(?,?,?)")
      .run(first, quote.symbol, Date.now());
    createSignal(first, quote.symbol, "ma20Above");
    const rule = getSignals(first).rules[0];
    assert.equal(recordSignalObservation(rule.id, fixture(), quote, now, true).checked, 0);
    assert.equal(
      recordSignalObservation(rule.id, fixture(), quote, new Date("2026-10-11T16:00:00+08:00"))
        .checked,
      0,
    );
    db().prepare("DELETE FROM watchlist WHERE user_id=?").run(first);
    assert.equal(recordSignalObservation(rule.id, fixture(), quote, now).checked, 0);
    db()
      .prepare("INSERT INTO watchlist(user_id,symbol,created_at) VALUES(?,?,?)")
      .run(first, quote.symbol, Date.now());
    const token = randomUUID();
    assert.equal(signalLease(token, now.getTime()), true);
    assert.equal(
      recordSignalObservation(rule.id, fixture(), quote, now, false, "other-owner").checked,
      0,
    );
    assert.equal(
      recordSignalObservation(rule.id, fixture(), quote, now, false, token).triggered,
      1,
    );
    signalLease(token, now.getTime(), true);
  }));
test("信号租约过期接手、续租与旧进程释放隔离", () => {
  const first = randomUUID(),
    second = randomUUID(),
    time = Date.now();
  try {
    assert.equal(signalLease(first, time), true);
    assert.equal(signalLease(second, time + 1), false);
    assert.equal(signalLease(first, time + 1000), true);
    assert.equal(signalLease(second, time + 302000), true);
    signalLease(first, time + 302001, true);
    assert.equal(signalLease(first, time + 302002), false);
    assert.equal(signalLease(second, time + 302002), true);
  } finally {
    signalLease(first, time, true);
    signalLease(second, time, true);
  }
});
