import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { getAlerts, recordAlertObservation } from "../../src/lib/alerts";
import type { AlertRule } from "../../src/lib/alert-types";
import type { Quote } from "../../src/lib/types";

// 本文件专用持久化数据库；不删除已有文件，清理范围仅限本次随机账号。
process.env.DATABASE_PATH = "./data/alerts-integration.db";

/** 构造明确标识为测试的数据；仅传入提醒评估函数，不进入真实行情接口。 */
function fixture(price: number, time: string, date = "2026-10-09", symbol = "sh600519"): Quote {
  return {
    symbol,
    name: "提醒集成测试夹具",
    price,
    previousClose: 100,
    open: 100,
    high: price,
    low: price,
    change: price - 100,
    changePercent: price - 100,
    volume: 100,
    amount: 10000,
    date,
    time,
    status: "00",
    bids: [],
    asks: [],
    totalShares: null,
    floatShares: null,
    marketCap: null,
    floatCap: null,
    pe: null,
    pb: null,
    turnover: null,
    amplitude: null,
  };
}

/** 把测试证券时间转换为同一中国标准时间采样时刻。 */
function observed(quote: Quote) {
  return new Date(`${quote.date}T${quote.time}+08:00`);
}

/** 创建随机测试账号，并在成功或失败后仅清理这些账号的级联数据。 */
async function withAccounts(run: (first: string, second: string) => void | Promise<void>) {
  const accounts = [randomUUID(), randomUUID()];
  try {
    for (const id of accounts)
      db()
        .prepare("INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)")
        .run(id, `${id}@integration.test`, "提醒集成测试", "test-only-unused-password", Date.now());
    await run(accounts[0], accounts[1]);
  } finally {
    for (const id of accounts) db().prepare("DELETE FROM users WHERE id=?").run(id);
  }
}

/** 在专用数据库创建阈值规则，默认价格向上穿越 100 元。 */
function createRule(
  userId: string,
  direction: AlertRule["direction"] = "above",
  metric: AlertRule["metric"] = "price",
  threshold = 100,
) {
  const id = randomUUID();
  db()
    .prepare(
      "INSERT INTO alert_rules(id,user_id,symbol,metric,direction,threshold,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(id, userId, "sh600519", metric, direction, threshold, Date.now());
  return id;
}

/** 上下穿越只触发一次，重复、乱序、不同证券及陈旧行情均不得污染基准。 */
test("提醒采样与一次触发、有效性及去重边界", async () =>
  withAccounts((user) => {
    const id = createRule(user);
    const first = fixture(99, "10:00:00");
    assert.equal(recordAlertObservation(id, first, observed(first)), 0);
    assert.equal(getAlerts(user).rules[0].previousValue, 99);
    const invalid = [
      fixture(101, "10:00:00"),
      fixture(101, "09:59:59"),
      fixture(101, "10:00:30", "2026-10-09", "sz000001"),
    ];
    for (const quote of invalid)
      assert.equal(recordAlertObservation(id, quote, new Date("2026-10-09T10:00:30+08:00")), 0);
    const stale = fixture(101, "10:00:30");
    assert.equal(recordAlertObservation(id, stale, observed(stale), true), 0);
    assert.equal(recordAlertObservation(id, stale, new Date("2026-10-09T10:05:00+08:00")), 0);
    assert.equal(getAlerts(user).rules[0].previousValue, 99);
    const crossing = fixture(100, "10:01:00");
    assert.equal(recordAlertObservation(id, crossing, observed(crossing)), 1);
    assert.equal(recordAlertObservation(id, crossing, observed(crossing)), 0);
    assert.equal(
      recordAlertObservation(id, fixture(101, "10:01:30"), new Date("2026-10-09T10:01:30+08:00")),
      0,
    );
    const result = getAlerts(user);
    assert.equal(result.events.length, 1);
    assert.equal(result.rules[0].enabled, false);
    assert.equal(result.events[0].value, 100);

    const downId = createRule(user, "below", "changePercent", -2);
    const before = fixture(99, "10:02:00"),
      down = fixture(98, "10:02:30");
    assert.equal(recordAlertObservation(downId, before, observed(before)), 0);
    assert.equal(recordAlertObservation(downId, down, observed(down)), 1);
    assert.equal(getAlerts(user).events.length, 2);
  }));

/** 跨交易日与重新启用均先建立新基准，暂停期间禁止更新或触发。 */
test("跨日重置和暂停重新启用的基准", async () =>
  withAccounts((user) => {
    const id = createRule(user);
    const previous = fixture(99, "14:59:00", "2026-10-08");
    assert.equal(recordAlertObservation(id, previous, observed(previous)), 0);
    const opening = fixture(101, "09:30:30");
    assert.equal(recordAlertObservation(id, opening, observed(opening)), 0);
    assert.equal(getAlerts(user).rules[0].previousValue, 101);
    db()
      .prepare("UPDATE alert_rules SET enabled=0,previous_value=NULL,previous_at=NULL WHERE id=?")
      .run(id);
    const paused = fixture(99, "09:31:00");
    assert.equal(recordAlertObservation(id, paused, observed(paused)), 0);
    assert.equal(getAlerts(user).rules[0].previousValue, null);
    db()
      .prepare("UPDATE alert_rules SET enabled=1,previous_value=NULL,previous_at=NULL WHERE id=?")
      .run(id);
    assert.equal(recordAlertObservation(id, paused, observed(paused)), 0);
    const next = fixture(100, "09:31:30");
    assert.equal(recordAlertObservation(id, next, observed(next)), 1);
    assert.equal(getAlerts(user).events.length, 1);
  }));

/** 删除规则保留事件，查询只能返回当前账号规则与历史。 */
test("规则删除保留历史且账号查询隔离", async () =>
  withAccounts((first, second) => {
    const id = createRule(first);
    createRule(second, "below");
    const baseline = fixture(99, "10:10:00"),
      crossing = fixture(101, "10:10:30");
    recordAlertObservation(id, baseline, observed(baseline));
    assert.equal(recordAlertObservation(id, crossing, observed(crossing)), 1);
    assert.equal(getAlerts(second).rules.length, 1);
    assert.equal(getAlerts(second).events.length, 0);
    db().prepare("DELETE FROM alert_rules WHERE id=? AND user_id=?").run(id, first);
    assert.equal(getAlerts(first).rules.length, 0);
    assert.equal(getAlerts(first).events.length, 1);
    assert.equal(getAlerts(first).events[0].ruleId, null);
    assert.equal(getAlerts(second).events.length, 0);
  }));
