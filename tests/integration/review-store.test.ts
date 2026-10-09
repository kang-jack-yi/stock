import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "../../src/lib/db";
import {
  acquireReviewCapture,
  getDailyReviews,
  releaseReviewCapture,
} from "../../src/lib/daily-review";
import { marketBreadth } from "../../src/lib/screener";
import type { ReviewAccount, ReviewMarket } from "../../src/lib/review-types";
import type { MarketStock } from "../../src/lib/types";

// 只向专用集成数据库写明确标识的历史夹具，不进入开发或生产数据库。
process.env.DATABASE_PATH = "./data/reviews-integration.db";

/** 独立 Node 进程与 SQLite 连接同时争抢同一租约，不以内存锁替代验证。 */
test("两个独立采集进程争抢SQLite租约只有一方成功", async () => {
  const command = `import review from './src/lib/daily-review.ts';
    const { acquireReviewCapture } = review;
    try { console.log(JSON.stringify({ owner: acquireReviewCapture() })); }
    catch (error) { console.log(JSON.stringify({ status: error.status, message: error.message })); }`;
  const execute = promisify(execFile);
  const results = await Promise.all(
    [0, 1].map(() =>
      execute(
        process.execPath,
        [
          "--experimental-sqlite",
          "--conditions=react-server",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          command,
        ],
        { env: { ...process.env, DATABASE_PATH: "./data/reviews-integration.db" } },
      ),
    ),
  );
  const states = results.map(
    (result) => JSON.parse(result.stdout.trim()) as { owner?: string; status?: number },
  );
  const owner = states.find((state) => state.owner)?.owner;
  try {
    assert.equal(states.filter((state) => state.owner).length, 1);
    assert.equal(states.filter((state) => state.status === 409).length, 1);
  } finally {
    if (owner) releaseReviewCapture(owner);
  }
});

/** 真实 SQLite 租约避免不同采集进程并发；错误所有者不能释放锁。 */
test("复盘采集跨进程租约去重和超时接管", () => {
  const first = acquireReviewCapture();
  try {
    assert.throws(() => acquireReviewCapture(), /正在采集/);
    releaseReviewCapture("wrong-owner");
    assert.throws(() => acquireReviewCapture(), /正在采集/);
    db()
      .prepare("UPDATE worker_status SET checked_at=? WHERE id='review-capture'")
      .run(Date.now() - 600001);
    const second = acquireReviewCapture();
    releaseReviewCapture(first);
    assert.throws(() => acquireReviewCapture(), /正在采集/);
    releaseReviewCapture(second);
  } finally {
    releaseReviewCapture(first);
  }
});

/** 测试用市场证券，不请求免费行情数据或运行收盘采集。 */
function fixtureStock(): MarketStock {
  return {
    symbol: "sh600519",
    name: "复盘集成测试夹具",
    price: 100,
    change: 1,
    changePercent: 1,
    volume: 100,
    amount: 10000,
    pe: 10,
    pb: 1,
    marketCap: 100000,
    floatCap: 100000,
    turnover: 1,
    time: "15:00:00",
  };
}
/** 用测试账号验证持久化读取；公开市场夹具只写专用测试库。 */
test("复盘历史按账号隔离、内容冻结，缺失日期仅比较相邻可用基线", () => {
  const users = [randomUUID(), randomUUID()];
  const dates = ["2026-09-28", "2026-09-30"];
  const connection = db();
  try {
    for (const id of users)
      connection
        .prepare("INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)")
        .run(
          id,
          `${id}@review-integration.test`,
          "复盘集成夹具",
          "unused-test-password",
          Date.now(),
        );
    for (const date of dates) {
      const stocks = [fixtureStock()];
      const market: ReviewMarket = {
        date,
        fetchedAt: `${date}T07:10:00.000Z`,
        startedAt: `${date}T07:06:00.000Z`,
        marketFetchedAt: `${date}T07:07:00.000Z`,
        sourceTotal: 1,
        stocks,
        excluded: [],
        breadth: marketBreadth(stocks, `${date}T07:06:00.000Z`),
        sectors: [],
        sectorFetchedAt: [`${date}T07:08:00.000Z`, `${date}T07:09:00.000Z`],
      };
      connection
        .prepare("INSERT OR REPLACE INTO review_markets(date,payload,fetched_at) VALUES(?,?,?)")
        .run(date, JSON.stringify(market), Date.parse(market.fetchedAt));
      const review: ReviewAccount = {
        date,
        savedAt: Date.now(),
        watchlist: stocks,
        unavailable: [],
        screeners: [
          {
            id: "test-scheme",
            name: "冻结方案",
            conditionHash: date === dates[0] ? "before" : "changed",
            matches: stocks.map(({ symbol, name }) => ({ symbol, name })),
          },
        ],
        alerts: [],
      };
      connection
        .prepare("INSERT INTO review_accounts(user_id,date,payload) VALUES(?,?,?)")
        .run(users[0], date, JSON.stringify(review));
    }
    const current = getDailyReviews(users[0]);
    assert.equal(current.selectedDate, dates[1]);
    assert.equal(current.previousDate, dates[0]);
    assert.equal(current.review?.watchlist[0].name, "复盘集成测试夹具");
    assert.equal(current.screeners[0].hasBaseline, false);
    assert.match(current.screeners[0].baselineLabel, /条件已变化/);
    assert.deepEqual(getDailyReviews(users[1]).dates, []);
    assert.equal(getDailyReviews(users[1], dates[1]).review, null);
    assert.equal(getDailyReviews(users[1], dates[1]).market, null);
    assert.equal(getDailyReviews(users[0], "2026-09-29").review, null);
    assert.equal(getDailyReviews(users[0], dates[0]).previousDate, null);
    connection
      .prepare("INSERT INTO watchlist(user_id,symbol,created_at) VALUES(?,?,?)")
      .run(users[0], "sz000001", Date.now());
    assert.deepEqual(
      getDailyReviews(users[0]).review?.watchlist.map((row) => row.symbol),
      ["sh600519"],
    );
    assert.equal(current.market?.verifiedTotal, 1);
    assert.ok(current.market);
    assert.equal(
      current.market.sourceTotal,
      current.market.verifiedTotal + current.market.excludedTotal,
    );
  } finally {
    for (const user of users) connection.prepare("DELETE FROM users WHERE id=?").run(user);
    for (const date of dates)
      connection.prepare("DELETE FROM review_markets WHERE date=?").run(date);
  }
});
