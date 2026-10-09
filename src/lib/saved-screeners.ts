import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./http";
import { screenerSorts, type ScreenerFilters } from "./screener";

/** 保存方案不包含页码，运行时始终从第一页开始。 */
export type SavedFilters = Omit<ScreenerFilters, "page">;

/** 当前账号的选股方案，不返回其他账号的信息。 */
export interface SavedScreener {
  /** 服务端生成的方案编号。 */
  id: string;
  /** 用户填写的方案名称，最多四十个字符。 */
  name: string;
  /** 已应用的筛选值；金额统一使用元。 */
  filters: SavedFilters;
  /** 创建时间，毫秒时间戳。 */
  createdAt: number;
  /** 最近改名或更新条件的时间，毫秒时间戳。 */
  updatedAt: number;
}

/** 数据库行只用于服务端映射，条件 JSON 已在写入前验证。 */
interface SavedRow {
  /** 方案编号。 */
  id: string;
  /** 方案名称。 */
  name: string;
  /** 经过白名单验证的条件 JSON。 */
  filters: string;
  /** 创建毫秒时间戳。 */
  created_at: number;
  /** 修改毫秒时间戳。 */
  updated_at: number;
}

const positive = z.number().finite().min(0).max(1e15).optional();
const change = z.number().finite().min(-100).max(10000).optional();
/** 与行情选股接口使用相同边界；严格拒绝额外字段、URL、字符串数值和页码。 */
export const savedFiltersSchema = z
  .object({
    market: z.enum(["all", "sh", "sz", "bj", "cyb", "kcb"]).default("all"),
    query: z.string().max(40).default(""),
    minPrice: positive,
    maxPrice: positive,
    minChange: change,
    maxChange: change,
    minPe: positive,
    maxPe: positive,
    maxPb: positive,
    minTurnover: positive,
    maxTurnover: positive,
    minCap: positive,
    maxCap: positive,
    minAmount: positive,
    profitable: z.boolean().default(false),
    excludeSt: z.boolean().default(false),
    sort: z.enum(screenerSorts).default("amount"),
    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [min, max] of [
      [value.minPrice, value.maxPrice],
      [value.minChange, value.maxChange],
      [value.minPe, value.maxPe],
      [value.minTurnover, value.maxTurnover],
      [value.minCap, value.maxCap],
    ])
      if (min !== undefined && max !== undefined && min > max)
        context.addIssue({ code: "custom", message: "下限不能高于上限" });
  });

/** 查询仅使用会话账号，按最近修改时间排序。 */
export function listSavedScreeners(userId: string): SavedScreener[] {
  const rows = db()
    .prepare(
      "SELECT id, name, filters, created_at, updated_at FROM saved_screeners WHERE user_id = ? ORDER BY updated_at DESC, id",
    )
    .all(userId) as unknown as SavedRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    filters: JSON.parse(row.filters) as SavedFilters,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** 新增方案，每个账号最多二十个，身份不由请求体决定。 */
export function createSavedScreener(userId: string, name: string, filters: SavedFilters) {
  const count = db()
    .prepare("SELECT COUNT(*) AS count FROM saved_screeners WHERE user_id = ?")
    .get(userId) as { count: number };
  if (count.count >= 20) throw new HttpError("最多保存 20 个选股方案");
  const id = randomUUID(),
    now = Date.now();
  db()
    .prepare(
      "INSERT INTO saved_screeners (id, user_id, name, filters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, userId, name, JSON.stringify(filters), now, now);
  return id;
}

/** 改名或覆盖条件时始终同时匹配方案和账号，其他账号编号视为不存在。 */
export function updateSavedScreener(
  userId: string,
  id: string,
  name?: string,
  filters?: SavedFilters,
) {
  const result = db()
    .prepare(
      "UPDATE saved_screeners SET name = COALESCE(?, name), filters = COALESCE(?, filters), updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .run(name ?? null, filters ? JSON.stringify(filters) : null, Date.now(), id, userId);
  if (!result.changes) throw new HttpError("选股方案不存在", 404);
}

/** 删除操作不能越过账号边界，误用其他账号编号返回不存在。 */
export function deleteSavedScreener(userId: string, id: string) {
  const result = db()
    .prepare("DELETE FROM saved_screeners WHERE id = ? AND user_id = ?")
    .run(id, userId);
  if (!result.changes) throw new HttpError("选股方案不存在", 404);
}
