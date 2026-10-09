import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./http";
import { quotes } from "./sina/client";
import { getUniverse } from "./sina/universe";
import { sectors } from "./sina/sectors";
import { listSavedScreeners } from "./saved-screeners";
import { marketBreadth } from "./screener";
import type { Quote } from "./types";
import type { AlertEvent } from "./alert-types";
import type { ReviewAccount, ReviewMarket, ReviewsResult } from "./review-types";
import {
  alignedReviewStock,
  compareReviewScreeners,
  compareReviewSectors,
  reviewCaptureWindow,
  reviewConditionKey,
  reviewMatches,
  reviewQuoteIssue,
  validReviewMeta,
} from "./review-compare";

const shared = globalThis as typeof globalThis & {
  /** 同一 Next 进程中的采集合并，避免多账号同时提交时重复上游请求。 */
  reviewCapture?: Promise<ReviewMarket>;
};

/** 按真实日期读取已验证的公共市场快照，不从运行时缓存复原历史。 */
function storedMarket(date: string): ReviewMarket | null {
  const row = db().prepare("SELECT payload FROM review_markets WHERE date=?").get(date) as
    { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as ReviewMarket) : null;
}

/** 只读取当前账号当时冻结的研究内容。 */
function storedAccount(userId: string, date: string): ReviewAccount | null {
  const row = db()
    .prepare("SELECT payload FROM review_accounts WHERE user_id=? AND date=?")
    .get(userId, date) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as ReviewAccount) : null;
}

/** 短事务领取跨进程采集租约，十分钟无心跳可接管，避免后台和手动重复抓取。 */
export function acquireReviewCapture() {
  const connection = db();
  const owner = randomUUID();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const lease = connection
      .prepare("SELECT checked_at FROM worker_status WHERE id='review-capture'")
      .get() as { checked_at: number } | undefined;
    if (lease && Date.now() - lease.checked_at < 600000)
      throw new HttpError("收盘快照正在采集，请稍后刷新查看，不重复请求上游", 409);
    connection
      .prepare(
        "INSERT INTO worker_status(id,checked_at,message) VALUES('review-capture',?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,message=excluded.message",
      )
      .run(Date.now(), owner);
    connection.exec("COMMIT");
    return owner;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

/** 只释放自己持有的租约，不删除其他进程接管后的记录。 */
export function releaseReviewCapture(owner: string) {
  db().prepare("DELETE FROM worker_status WHERE id='review-capture' AND message=?").run(owner);
}

/** 网络采集不占用 SQLite 写锁，定期续租并在成功或失败时释放。 */
async function collectSharedMarket(date: string) {
  const owner = acquireReviewCapture();
  const heartbeat = setInterval(() => {
    db()
      .prepare("UPDATE worker_status SET checked_at=? WHERE id='review-capture' AND message=?")
      .run(Date.now(), owner);
  }, 30000);
  try {
    const market = storedMarket(date) ?? (await collectMarket());
    // 公共记录在释放租约前提交；否则别的进程可能在短暂空窗重复抓取。
    persistReviews(market, undefined, owner);
    return storedMarket(date)!;
  } finally {
    clearInterval(heartbeat);
    releaseReviewCapture(owner);
  }
}

/** 完整市场抓取、指数及逐股日期验证、行业和概念全部成功后才返回候选快照。 */
async function collectMarket(): Promise<ReviewMarket> {
  const window = reviewCaptureWindow();
  if (!window.allowed) throw new HttpError(window.label, 409);
  const date = window.date;
  const [universe, indices, industry, concept] = await Promise.all([
    getUniverse(),
    quotes(["sh000001", "sz399001"]),
    sectors("industry"),
    sectors("concept"),
  ]);
  const sources = [universe.meta, indices.meta, industry.meta, concept.meta];
  if (sources.some((meta) => !validReviewMeta(meta, date, new Date())))
    throw new HttpError("存在盘中、跨日或降级缓存，未保存收盘复盘，请稍后重试", 409);
  if (
    !validReviewMeta(
      { ...universe.meta, fetchedAt: universe.data.breadth.startedAt },
      date,
      new Date(),
    )
  )
    throw new HttpError("市场快照在收盘前开始采集，未保存复盘，请稍后重试", 409);
  for (const symbol of ["sh000001", "sz399001"]) {
    const issue = reviewQuoteIssue(
      indices.data.find((row) => row.symbol === symbol),
      date,
    );
    if (issue) throw new HttpError(`指数日期无法确认：${issue}`, 409);
  }
  if (!industry.data.sectors.length || !concept.data.sectors.length)
    throw new HttpError("板块汇总未完整返回，未保存复盘", 502);
  const verified = new Map<string, Quote>();
  const batches: string[][] = [];
  for (let start = 0; start < universe.data.stocks.length; start += 60)
    batches.push(universe.data.stocks.slice(start, start + 60).map((row) => row.symbol));
  let cursor = 0;
  /** 四个并发请求共享任务队列；请求失败时整批不保存。 */
  async function validateBatch() {
    while (cursor < batches.length) {
      const result = await quotes(batches[cursor++]);
      if (!validReviewMeta(result.meta, date, new Date()))
        throw new HttpError("逐股日期验证使用了陈旧行情，未保存复盘", 409);
      for (const quote of result.data) verified.set(quote.symbol, quote);
    }
  }
  await Promise.all(Array.from({ length: 4 }, validateBatch));
  const stocks: ReviewMarket["stocks"] = [];
  const excluded: ReviewMarket["excluded"] = [];
  for (const stock of universe.data.stocks) {
    const quote = verified.get(stock.symbol);
    const issue = reviewQuoteIssue(quote, date);
    if (issue) {
      excluded.push({ symbol: stock.symbol, name: stock.name, reason: issue });
      continue;
    }
    if (!alignedReviewStock(stock, quote!))
      throw new HttpError("排行与收盘行情不一致，未保存不完整复盘，请稍后重试", 409);
    stocks.push(stock);
  }
  if (!stocks.length) throw new HttpError("没有当日可验证收盘行情，未保存复盘", 409);
  const completed = new Date();
  if (reviewCaptureWindow(completed).date !== date)
    throw new HttpError("采集跨越交易日期，未保存复盘", 409);
  return {
    date,
    fetchedAt: completed.toISOString(),
    startedAt: universe.data.breadth.startedAt,
    marketFetchedAt: universe.meta.fetchedAt,
    sourceTotal: universe.data.stocks.length,
    stocks,
    excluded,
    breadth: marketBreadth(stocks, universe.data.breadth.startedAt),
    sectors: [...industry.data.sectors, ...concept.data.sectors],
    sectorFetchedAt: [industry.meta.fetchedAt, concept.meta.fetchedAt],
  };
}

/** 冻结账号现有自选、方案完整匹配集合和当天提醒，不接受外部账号数据。 */
function accountSnapshot(userId: string, market: ReviewMarket): ReviewAccount {
  const symbols = db()
    .prepare("SELECT symbol FROM watchlist WHERE user_id=? ORDER BY created_at")
    .all(userId)
    .map((row) => String(row.symbol));
  const wanted = new Set(symbols);
  const available = new Set(market.stocks.map((row) => row.symbol));
  const excluded = new Map(market.excluded.map((row) => [row.symbol, row]));
  const start = Date.parse(`${market.date}T00:00:00+08:00`);
  const events = db()
    .prepare(
      `SELECT id, rule_id AS ruleId, symbol, name, metric, direction,
    threshold, value, quote_at AS quoteAt, read_at IS NOT NULL AS read FROM alert_events
    WHERE user_id=? AND quote_at>=? AND quote_at<? ORDER BY quote_at DESC`,
    )
    .all(userId, new Date(start).toISOString(), new Date(start + 86400000).toISOString())
    .map((row) => ({ ...row, read: !!row.read })) as unknown as AlertEvent[];
  return {
    date: market.date,
    savedAt: Date.now(),
    watchlist: market.stocks.filter((row) => wanted.has(row.symbol)),
    unavailable: symbols
      .filter((symbol) => !available.has(symbol))
      .map(
        (symbol) =>
          excluded.get(symbol) ?? {
            symbol,
            name: symbol,
            reason: "不在源 A 股目录或无法验证收盘，未参与统计",
          },
      ),
    screeners: listSavedScreeners(userId).map((scheme) => ({
      id: scheme.id,
      name: scheme.name,
      conditionHash: createHash("sha256").update(reviewConditionKey(scheme.filters)).digest("hex"),
      matches: reviewMatches(market.stocks, scheme.filters),
    })),
    alerts: events,
  };
}

/** 事务内按日去重公共快照及账号历史，保留最近 120 个实际采集交易日。 */
function persistReviews(candidate: ReviewMarket, userId?: string, captureOwner?: string) {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    if (captureOwner) {
      const lease = connection
        .prepare("SELECT checked_at,message FROM worker_status WHERE id='review-capture'")
        .get() as { checked_at: number; message: string } | undefined;
      const window = reviewCaptureWindow();
      if (!lease || lease.message !== captureOwner || Date.now() - lease.checked_at >= 600000)
        throw new HttpError("采集租约已失效，未保存历史，请稍后重试", 409);
      if (!window.allowed || window.date !== candidate.date)
        throw new HttpError("采集已跨越交易日期，未保存历史", 409);
    }
    connection
      .prepare("INSERT OR IGNORE INTO review_markets(date,payload,fetched_at) VALUES(?,?,?)")
      .run(candidate.date, JSON.stringify(candidate), Date.parse(candidate.fetchedAt));
    const market = storedMarket(candidate.date)!;
    const users = captureOwner
      ? []
      : userId
        ? [userId]
        : connection
            .prepare("SELECT id FROM users")
            .all()
            .map((row) => String(row.id));
    for (const id of users) {
      if (storedAccount(id, market.date)) continue;
      const review = accountSnapshot(id, market);
      connection
        .prepare("INSERT INTO review_accounts(user_id,date,payload) VALUES(?,?,?)")
        .run(id, market.date, JSON.stringify(review));
    }
    connection
      .prepare(
        "DELETE FROM review_markets WHERE date NOT IN (SELECT date FROM review_markets ORDER BY date DESC LIMIT 120)",
      )
      .run();
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

/** 后台与账号手动保存共用同日公共采集，不补造过去缺失日期。 */
export async function captureDailyReview(userId?: string) {
  const window = reviewCaptureWindow();
  if (!window.allowed) throw new HttpError(window.label, 409);
  let market = storedMarket(window.date);
  if (!market) {
    if (!shared.reviewCapture)
      shared.reviewCapture = collectSharedMarket(window.date).finally(() => {
        shared.reviewCapture = undefined;
      });
    market = await shared.reviewCapture;
  }
  const completedWindow = reviewCaptureWindow();
  if (!completedWindow.allowed || completedWindow.date !== market.date)
    throw new HttpError("采集已跨越日期或离开有效窗口，未保存复盘", 409);
  persistReviews(market, userId);
  return { ok: true, date: market.date, message: "当日收盘复盘已保存；再次保存不会重写历史" };
}

/** 独立后台采集心跳；手动保存不冒充后台已运行。 */
export function reviewWorkerHeartbeat(message: string) {
  db()
    .prepare(
      "INSERT INTO worker_status(id,checked_at,message) VALUES('reviews',?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,message=excluded.message",
    )
    .run(Date.now(), message);
}

/** 返回账户隔离的历史和相邻可用基线，首次访问不自动制造历史。 */
export function getDailyReviews(userId: string, requestedDate?: string): ReviewsResult {
  const dates = db()
    .prepare("SELECT date FROM review_accounts WHERE user_id=? ORDER BY date DESC LIMIT 120")
    .all(userId)
    .map((row) => String(row.date));
  const selectedDate = requestedDate ?? dates[0] ?? null;
  const review = selectedDate ? storedAccount(userId, selectedDate) : null;
  const market = review ? storedMarket(review.date) : null;
  const previousDate = review ? (dates.find((date) => date < review.date) ?? null) : null;
  const previous = previousDate ? storedAccount(userId, previousDate) : null;
  const previousMarket = previousDate ? storedMarket(previousDate) : null;
  const worker = db()
    .prepare("SELECT checked_at,message FROM worker_status WHERE id='reviews'")
    .get() as { checked_at: number; message: string } | undefined;
  const window = reviewCaptureWindow();
  return {
    today: window.date,
    canCapture: window.allowed,
    captureLabel: window.label,
    dates,
    selectedDate,
    previousDate,
    review,
    market: market
      ? {
          date: market.date,
          fetchedAt: market.fetchedAt,
          startedAt: market.startedAt,
          marketFetchedAt: market.marketFetchedAt,
          sectorFetchedAt: market.sectorFetchedAt,
          sourceTotal: market.sourceTotal,
          breadth: market.breadth,
          verifiedTotal: market.stocks.length,
          excludedTotal: market.excluded.length,
        }
      : null,
    screeners: compareReviewScreeners(
      review?.screeners ?? [],
      previous?.screeners,
      market?.excluded.map((row) => row.symbol),
      previousMarket?.excluded.map((row) => row.symbol),
    ),
    sectors: compareReviewSectors(market?.sectors ?? [], previousMarket?.sectors),
    workerAt: worker?.checked_at ?? null,
    workerRunning: !!worker && Date.now() - worker.checked_at < 90000,
    workerMessage: worker?.message ?? "每日采集进程未启动",
  };
}
