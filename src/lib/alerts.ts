import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { quotes } from "./sina/client";
import { tradingSession } from "./trading-calendar";
import { crossesThreshold, validAlertQuote } from "./alert-evaluation";
import type { AlertRule, AlertEvent, AlertsResult, AlertCheckResult } from "./alert-types";
import type { Quote } from "./types";

/** 数据库内部规则行；用户编号只在服务端使用。 */
interface RuleRow {
  /** UUID。 */
  id: string;
  /** 归属账号。 */
  user_id: string;
  /** 证券代码。 */
  symbol: string;
  /** 指标。 */
  metric: AlertRule["metric"];
  /** 方向。 */
  direction: AlertRule["direction"];
  /** 阈值。 */
  threshold: number;
  /** SQLite 布尔值。 */
  enabled: number;
  /** 上次值。 */
  previous_value: number | null;
  /** 上次行情时间。 */
  previous_at: string | null;
  /** 创建时间。 */
  created_at: number;
}
/** 将数据库规则转换成公开的普通对象。 */
function publicRule(row: RuleRow): AlertRule {
  return {
    id: row.id,
    symbol: row.symbol,
    metric: row.metric,
    direction: row.direction,
    threshold: row.threshold,
    enabled: !!row.enabled,
    previousValue: row.previous_value,
    previousAt: row.previous_at,
    createdAt: row.created_at,
  };
}
/** 读取个人规则及最近记录；后台心跳不包含任何账号数据。 */
export function getAlerts(userId: string): AlertsResult {
  const rules = (
    db()
      .prepare("SELECT * FROM alert_rules WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as unknown as RuleRow[]
  ).map(publicRule);
  const events = db()
    .prepare(
      `SELECT id, rule_id AS ruleId, symbol, name, metric, direction, threshold, value, quote_at AS quoteAt, read_at IS NOT NULL AS read FROM alert_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .all(userId)
    .map((row) => ({ ...row, read: !!row.read })) as unknown as AlertEvent[];
  const worker = db()
    .prepare("SELECT checked_at, message FROM worker_status WHERE id = 'alerts'")
    .get() as { checked_at: number; message: string } | undefined;
  return {
    rules,
    events,
    workerAt: worker?.checked_at ?? null,
    workerRunning: !!worker && Date.now() - worker.checked_at < 90000,
    workerMessage: worker?.message ?? "后台检查进程未启动",
  };
}
/** 验证行情后在写锁内复核规则和时间，保证并发检查不会重复触发。 */
export function recordAlertObservation(ruleId: string, quote: Quote, now: Date, stale = false) {
  if (!validAlertQuote(quote, stale, now)) return 0;
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const row = connection
      .prepare("SELECT * FROM alert_rules WHERE id = ? AND enabled = 1")
      .get(ruleId) as unknown as RuleRow | undefined;
    if (!row || row.symbol !== quote.symbol) {
      connection.exec("COMMIT");
      return 0;
    }
    const at = new Date(`${quote.date}T${quote.time}+08:00`).toISOString();
    const value = quote[row.metric];
    if (value == null || !Number.isFinite(value) || (row.previous_at && at <= row.previous_at)) {
      connection.exec("COMMIT");
      return 0;
    }
    // 不同交易日重新建立基准，避免把休市期间发生的变化当作实时穿越。
    const sameDay =
      row.previous_at &&
      new Date(row.previous_at).getTime() >= Date.parse(`${quote.date}T00:00:00+08:00`);
    const rule = { ...publicRule(row), previousValue: sameDay ? row.previous_value : null };
    const triggered = crossesThreshold(rule, value);
    if (triggered)
      connection
        .prepare(
          "INSERT INTO alert_events (id,rule_id,user_id,symbol,name,metric,direction,threshold,value,quote_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          row.id,
          row.user_id,
          row.symbol,
          quote.name,
          row.metric,
          row.direction,
          row.threshold,
          value,
          at,
          now.getTime(),
        );
    connection
      .prepare(
        "UPDATE alert_rules SET previous_value = ?, previous_at = ?, enabled = ? WHERE id = ?",
      )
      .run(value, at, triggered ? 0 : 1, row.id);
    if (triggered)
      connection
        .prepare(
          "DELETE FROM alert_events WHERE user_id = ? AND id NOT IN (SELECT id FROM alert_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000)",
        )
        .run(row.user_id, row.user_id);
    connection.exec("COMMIT");
    return triggered ? 1 : 0;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
/** 批量检查规则，个人手动检查和后台进程共用有效行情及去重逻辑。 */
export async function checkAlerts(userId?: string): Promise<AlertCheckResult> {
  const now = new Date();
  const session = tradingSession(now);
  if (!session.active) return { checked: 0, triggered: 0, message: `${session.label}，未检查行情` };
  const rules = (userId
    ? db().prepare("SELECT * FROM alert_rules WHERE enabled = 1 AND user_id = ?").all(userId)
    : db().prepare("SELECT * FROM alert_rules WHERE enabled = 1").all()) as unknown as RuleRow[];
  const symbols = [...new Set(rules.map((row) => row.symbol))];
  let checked = 0,
    triggered = 0;
  for (let i = 0; i < symbols.length; i += 60) {
    const response = await quotes(symbols.slice(i, i + 60));
    const observedAt = new Date();
    for (const quote of response.data) {
      if (!validAlertQuote(quote, response.meta.stale, observedAt)) continue;
      for (const row of rules.filter((rule) => rule.symbol === quote.symbol)) {
        if (quote[row.metric] == null || !Number.isFinite(quote[row.metric])) continue;
        checked++;
        triggered += recordAlertObservation(row.id, quote, observedAt, response.meta.stale);
      }
    }
  }
  return {
    checked,
    triggered,
    message: `检查了 ${checked} 条有效规则，触发 ${triggered} 条；首次采样仅建立基准`,
  };
}
/** 后台进程更新心跳；手动检查不会被误显示为后台已运行。 */
export function workerHeartbeat(message: string) {
  db()
    .prepare(
      "INSERT INTO worker_status (id,checked_at,message) VALUES ('alerts',?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,message=excluded.message",
    )
    .run(Date.now(), message);
}
