import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./http";
import { portfolioTransactions } from "./portfolio-store";
import { replayPortfolio } from "./portfolio-calculation";
import { getTechnical } from "./technical";
import { quotes } from "./sina/client";
import { signalWindow, evaluateSignal, validSignalClose } from "./signal-evaluation";
import type {
  SignalRule,
  SignalEvent,
  SignalKind,
  SignalsResult,
  SignalCheckResult,
} from "./signal-types";
import type { TechnicalPoint } from "./technical-types";
import type { Quote } from "./types";

/** 所有读取固定账号条件，公开字段使用共享类型。 */
export function getTechnicalEvents(userId: string): SignalEvent[] {
  return db()
    .prepare(
      "SELECT id,rule_id AS ruleId,symbol,name,kind,value,date,created_at AS createdAt,read_at IS NOT NULL AS read FROM signal_events WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
    )
    .all(userId)
    .map((row) => ({ ...row, read: !!row.read })) as unknown as SignalEvent[];
}
/** 当前账号规则和触发历史；心跳与手动检查分开。 */
export function getSignals(userId: string): SignalsResult {
  const rules = db()
    .prepare(
      "SELECT id,symbol,kind,enabled,checked_date AS checkedDate,created_at AS createdAt FROM signal_rules WHERE user_id=? ORDER BY created_at DESC",
    )
    .all(userId)
    .map((row) => ({ ...row, enabled: !!row.enabled })) as unknown as SignalRule[];
  const worker = db()
    .prepare("SELECT checked_at AS at,message FROM worker_status WHERE id='signals'")
    .get() as
    | {
        /** 独立技术检查进程最近心跳的 Unix 毫秒时间。 */
        at: number;
        /** 后台最近检查结果或休市提示，不含个人数据。 */
        message: string;
      }
    | undefined;
  return {
    rules,
    events: getTechnicalEvents(userId),
    workerAt: worker?.at ?? null,
    workerRunning: !!worker && Date.now() - worker.at < 90000,
    workerMessage: worker?.message ?? "技术信号后台未启动",
  };
}
/** 只监控实际自选和当前正持仓；已清仓的旧代码不纳入历史请求。 */
function trackedSymbols(userId: string): Set<string> {
  const watch = db()
    .prepare("SELECT symbol FROM watchlist WHERE user_id=?")
    .all(userId)
    .map((row) => String(row.symbol));
  const held = replayPortfolio(portfolioTransactions(userId))
    .positions.filter((row) => row.quantity > 0)
    .map((row) => row.symbol);
  return new Set([...watch, ...held]);
}
/** 创建固定条件，重复条件或不在关注范围内的证券拒绝，限制每人 80 条。 */
export function createSignal(userId: string, symbol: string, kind: SignalKind) {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    if (!trackedSymbols(userId).has(symbol))
      throw new HttpError("请先将股票加入自选或记录当前持仓");
    const rows = getSignals(userId).rules;
    if (rows.length >= 80) throw new HttpError("每个账号最多保存 80 条技术条件");
    if (rows.some((row) => row.symbol === symbol && row.kind === kind))
      throw new HttpError("该股票条件已订阅");
    connection
      .prepare("INSERT INTO signal_rules(id,user_id,symbol,kind,created_at) VALUES(?,?,?,?,?)")
      .run(randomUUID(), userId, symbol, kind, Date.now());
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
/** 删除或暂停规则必须带会话账号；重新启用保留日期去重，不能重复当天提醒。 */
export function updateSignal(userId: string, id: string, enabled?: boolean) {
  const result =
    enabled === undefined
      ? db().prepare("DELETE FROM signal_rules WHERE id=? AND user_id=?").run(id, userId)
      : db()
          .prepare("UPDATE signal_rules SET enabled=? WHERE id=? AND user_id=?")
          .run(Number(enabled), id, userId);
  if (!result.changes) throw new HttpError("技术条件不存在", 404);
}
/** 标记个人记录已读；删除规则不删除历史。 */
export function markSignalRead(userId: string, id?: string) {
  const result = id
    ? db()
        .prepare("UPDATE signal_events SET read_at=? WHERE id=? AND user_id=?")
        .run(Date.now(), id, userId)
    : db()
        .prepare("UPDATE signal_events SET read_at=? WHERE user_id=? AND read_at IS NULL")
        .run(Date.now(), userId);
  if (id && !result.changes) throw new HttpError("技术记录不存在", 404);
}
/** 在写锁中复核有效日线、账号关注范围和规则日期，实现跨进程每日一次。 */
export function recordSignalObservation(
  ruleId: string,
  points: TechnicalPoint[],
  quote: Quote,
  now: Date,
  stale = false,
  leaseToken?: string,
) {
  if (!validSignalClose(points, quote, stale, now)) return { checked: 0, triggered: 0 };
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    if (leaseToken) {
      const lease = connection
        .prepare("SELECT checked_at AS at,message FROM worker_status WHERE id='signals-lease'")
        .get() as
        | {
            /** 租约最近续期的 Unix 毫秒时间，超过五分钟视为失效。 */
            at: number;
            /** 租约所有者的随机令牌，用于防止旧进程提交。 */
            message: string;
          }
        | undefined;
      if (!lease || lease.message !== leaseToken || now.getTime() - lease.at >= 300000) {
        connection.exec("COMMIT");
        return { checked: 0, triggered: 0 };
      }
    }
    const row = connection
      .prepare(
        "SELECT id,user_id AS userId,symbol,kind,checked_date AS checkedDate FROM signal_rules WHERE id=? AND enabled=1",
      )
      .get(ruleId) as
      | {
          /** 服务端规则 UUID。 */
          id: string;
          /** 数据库中的归属账号，只在服务端复核关注范围。 */
          userId: string;
          /** 规则对应的 A 股证券代码。 */
          symbol: string;
          /** 服务端固定事实条件枚举。 */
          kind: SignalKind;
          /** 最近完整检查的收盘日期；尚未有效采样为 null。 */
          checkedDate: string | null;
        }
      | undefined;
    const last = points.at(-1)!;
    if (
      !row ||
      row.symbol !== quote.symbol ||
      (row.checkedDate && row.checkedDate >= last.date) ||
      !trackedSymbols(row.userId).has(row.symbol)
    ) {
      connection.exec("COMMIT");
      return { checked: 0, triggered: 0 };
    }
    const result = evaluateSignal(row.kind, points.at(-2)!, last);
    if (!result.ready) {
      connection.exec("COMMIT");
      return { checked: 0, triggered: 0 };
    }
    if (result.triggered)
      connection
        .prepare(
          "INSERT INTO signal_events(id,rule_id,user_id,symbol,name,kind,value,date,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          row.id,
          row.userId,
          row.symbol,
          quote.name,
          row.kind,
          result.value!,
          last.date,
          now.getTime(),
        );
    connection.prepare("UPDATE signal_rules SET checked_date=? WHERE id=?").run(last.date, row.id);
    connection
      .prepare(
        "DELETE FROM signal_events WHERE user_id=? AND id NOT IN(SELECT id FROM signal_events WHERE user_id=? ORDER BY created_at DESC LIMIT 1000)",
      )
      .run(row.userId, row.userId);
    connection.exec("COMMIT");
    return { checked: 1, triggered: Number(result.triggered) };
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
/** 共享跨进程租约减少重复历史抓取；过期后新进程可接手，旧进程不覆盖所有者。 */
export function signalLease(token: string, now = Date.now(), release = false) {
  if (release) {
    db().prepare("DELETE FROM worker_status WHERE id='signals-lease' AND message=?").run(token);
    return false;
  }
  const result = db()
    .prepare(
      "INSERT INTO worker_status(id,checked_at,message) VALUES('signals-lease',?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,message=excluded.message WHERE worker_status.checked_at<? OR worker_status.message=excluded.message",
    )
    .run(now, token, now - 300000);
  return !!result.changes;
}
/** 每个交易日仅在盘后检查有效自选/持仓，单股并发最高 3，不扫描全市场历史。 */
export async function checkSignals(userId?: string): Promise<SignalCheckResult> {
  const window = signalWindow();
  if (!window.allowed) return { checked: 0, triggered: 0, skipped: 0, message: window.label };
  const token = randomUUID();
  if (!signalLease(token)) throw new HttpError("技术信号正在检查，请稍后查看记录", 409);
  const heartbeat = setInterval(() => signalLease(token), 30000);
  let checked = 0,
    triggered = 0,
    skipped = 0;
  try {
    const rules = (
      userId
        ? db()
            .prepare(
              "SELECT id,user_id AS userId,symbol FROM signal_rules WHERE enabled=1 AND user_id=? AND (checked_date IS NULL OR checked_date<?)",
            )
            .all(userId, window.date)
        : db()
            .prepare(
              "SELECT id,user_id AS userId,symbol FROM signal_rules WHERE enabled=1 AND (checked_date IS NULL OR checked_date<?)",
            )
            .all(window.date)
    ) as {
      /** 待检查规则的 UUID，提交时再次读取当前状态。 */
      id: string;
      /** 规则归属账号，仅服务端计算各自的自选及现持仓集合。 */
      userId: string;
      /** 待抓取前复权日线的 A 股代码。 */
      symbol: string;
    }[];
    const scope = new Map<string, Set<string>>();
    const eligible = rules.filter((row) => {
      if (!scope.has(row.userId)) scope.set(row.userId, trackedSymbols(row.userId));
      const valid = scope.get(row.userId)!.has(row.symbol);
      if (!valid) skipped++;
      return valid;
    });
    const symbols = [...new Set(eligible.map((row) => row.symbol))];
    for (let i = 0; i < symbols.length; i += 3) {
      await Promise.all(
        symbols.slice(i, i + 3).map(async (symbol) => {
          const rows = eligible.filter((row) => row.symbol === symbol);
          try {
            const [history, live] = await Promise.all([
              getTechnical(symbol, "qfq"),
              quotes([symbol]),
            ]);
            const quote = live.data.find((row) => row.symbol === symbol);
            if (
              !quote ||
              history.meta.stale ||
              live.meta.stale ||
              !validSignalClose(history.data.points, quote, false, new Date())
            ) {
              skipped += rows.length;
              return;
            }
            for (const row of rows) {
              const result = recordSignalObservation(
                row.id,
                history.data.points,
                quote,
                new Date(),
                false,
                token,
              );
              checked += result.checked;
              triggered += result.triggered;
              if (!result.checked) skipped++;
            }
          } catch {
            skipped += rows.length;
          }
        }),
      );
    }
    return {
      checked,
      triggered,
      skipped,
      message: `收盘检查 ${checked} 条，新增 ${triggered} 条，跳过 ${skipped} 条（暖机不足、旧日期、数据缺失或已不在自选/持仓）；条件仅描述事实`,
    };
  } finally {
    clearInterval(heartbeat);
    signalLease(token, Date.now(), true);
  }
}
/** 后台独立进程心跳；手动检查不将后台显示为在线。 */
export function signalHeartbeat(message: string) {
  db()
    .prepare(
      "INSERT INTO worker_status(id,checked_at,message) VALUES('signals',?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,message=excluded.message",
    )
    .run(Date.now(), message);
}
