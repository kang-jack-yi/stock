import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./http";
import type { ResearchEntry, ResearchGroup, ResearchWorkspace } from "./research-types";

/** 数据库列与公开字段之间的映射，仅存在于服务端。 */
interface EntryRow {
  /** 证券代码。 */
  symbol: string;
  /** 可空分组外键。 */
  group_id: string | null;
  /** 研究笔记文本。 */
  note: string;
  /** JSON 标签数组。 */
  tags: string;
  /** 复查日期。 */
  review_date: string;
  /** 自定义排序。 */
  position: number;
}

/** 查询账号隔离的研究记录，将 SQLite 行转为普通对象。 */
export function researchWorkspace(userId: string): ResearchWorkspace {
  const groups = db()
    .prepare("SELECT id,name FROM research_groups WHERE user_id=? ORDER BY created_at,id")
    .all(userId) as unknown as ResearchGroup[];
  const rows = db()
    .prepare(
      "SELECT symbol,group_id,note,tags,review_date,position FROM research_entries WHERE user_id=? ORDER BY position,symbol",
    )
    .all(userId) as unknown as EntryRow[];
  return {
    groups: groups.map((group) => ({ id: group.id, name: group.name })),
    entries: rows.map((row) => ({
      symbol: row.symbol,
      groupId: row.group_id,
      note: row.note,
      tags: JSON.parse(row.tags),
      reviewDate: row.review_date,
      position: row.position,
    })),
  };
}

/** 校验分组属于当前账号，跨账号编号统一视为不存在。 */
function requireGroup(userId: string, id: string) {
  if (!db().prepare("SELECT 1 FROM research_groups WHERE user_id=? AND id=?").get(userId, id))
    throw new HttpError("分组不存在或已被删除", 404);
}

/** 创建或重命名分组；同一账号名称唯一，最多 20 个分组。 */
export function saveResearchGroup(userId: string, name: string, id?: string) {
  if (id) requireGroup(userId, id);
  const duplicate = db()
    .prepare("SELECT id FROM research_groups WHERE user_id=? AND name=?")
    .get(userId, name) as { id: string } | undefined;
  if (duplicate && duplicate.id !== id) throw new HttpError("已有同名分组", 409);
  if (id)
    db()
      .prepare("UPDATE research_groups SET name=? WHERE user_id=? AND id=?")
      .run(name, userId, id);
  else {
    const count = db()
      .prepare("SELECT COUNT(*) AS count FROM research_groups WHERE user_id=?")
      .get(userId) as { count: number };
    if (count.count >= 20) throw new HttpError("最多创建 20 个分组");
    db()
      .prepare("INSERT INTO research_groups(id,user_id,name,created_at) VALUES(?,?,?,?)")
      .run(randomUUID(), userId, name, Date.now());
  }
}

/** 保存研究内容，禁止把记录挂到其他账号的分组。 */
export function saveResearchEntry(userId: string, entry: ResearchEntry) {
  if (entry.groupId) requireGroup(userId, entry.groupId);
  const existing = db()
    .prepare("SELECT 1 FROM research_entries WHERE user_id=? AND symbol=?")
    .get(userId, entry.symbol);
  const count = db()
    .prepare("SELECT COUNT(*) AS count FROM research_entries WHERE user_id=?")
    .get(userId) as { count: number };
  if (!existing && count.count >= 200)
    throw new HttpError("最多保存 200 只股票的研究记录，请先清理不用的记录");
  db()
    .prepare(
      `INSERT INTO research_entries(user_id,symbol,group_id,note,tags,review_date,position,updated_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,symbol) DO UPDATE SET group_id=excluded.group_id,note=excluded.note,tags=excluded.tags,review_date=excluded.review_date,position=excluded.position,updated_at=excluded.updated_at`,
    )
    .run(
      userId,
      entry.symbol,
      entry.groupId,
      entry.note,
      JSON.stringify(entry.tags),
      entry.reviewDate,
      entry.position,
      Date.now(),
    );
}

/** 对完整的当前自选列表排序，拒绝遗漏、重复或已经移除的成员。 */
export function orderResearchEntries(userId: string, symbols: string[]) {
  const watch = db().prepare("SELECT symbol FROM watchlist WHERE user_id=?").all(userId) as {
    symbol: string;
  }[];
  if (
    symbols.length !== watch.length ||
    new Set(symbols).size !== symbols.length ||
    watch.some((row) => !symbols.includes(row.symbol))
  )
    throw new HttpError("自选列表已变化，请刷新后重新排序", 409);
  const count = db()
    .prepare("SELECT COUNT(*) AS count FROM research_entries WHERE user_id=?")
    .get(userId) as { count: number };
  const missing = symbols.filter(
    (symbol) =>
      !db()
        .prepare("SELECT 1 FROM research_entries WHERE user_id=? AND symbol=?")
        .get(userId, symbol),
  );
  if (count.count + missing.length > 200)
    throw new HttpError("研究记录已达上限，请先清理不用的记录");
  db().exec("BEGIN IMMEDIATE");
  try {
    const statement = db()
      .prepare(`INSERT INTO research_entries(user_id,symbol,position,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(user_id,symbol) DO UPDATE SET position=excluded.position,updated_at=excluded.updated_at`);
    symbols.forEach((symbol, index) => statement.run(userId, symbol, index + 1, Date.now()));
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}

/** 删除分组只释放关联，不删除自选成员或研究内容。 */
export function deleteResearchGroup(userId: string, id: string) {
  requireGroup(userId, id);
  db().prepare("DELETE FROM research_groups WHERE user_id=? AND id=?").run(userId, id);
}

/** 清除某只股票的研究内容，不改变收藏状态。 */
export function deleteResearchEntry(userId: string, symbol: string) {
  db().prepare("DELETE FROM research_entries WHERE user_id=? AND symbol=?").run(userId, symbol);
}
