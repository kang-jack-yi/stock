import "server-only";
import { db } from "./db";
import { HttpError } from "./http";
import type { IntelligenceEntry, IntelligenceItem } from "./intelligence-types";

/** 私有数据库行，只持久化服务端验证的公开标题元数据。 */
interface EntryRow {
  /** 元数据 JSON。 */
  payload: string;
  /** 阅读毫秒时间；null 表示未读。 */
  read_at: number | null;
  /** SQLite 收藏布尔值。 */
  saved: number;
}

/** 读取账号保留的最近情报；收藏不会因来源移除而消失。 */
export function intelligenceEntries(userId: string): IntelligenceItem[] {
  return (
    db()
      .prepare("SELECT payload,read_at,saved FROM intelligence_entries WHERE user_id=?")
      .all(userId) as unknown as EntryRow[]
  ).map((row) => ({
    ...(JSON.parse(row.payload) as IntelligenceEntry),
    read: row.read_at !== null,
    saved: !!row.saved,
  }));
}

/** 更新经过上游验证的标题快照，保留阅读/收藏状态；最多保留3000条未收藏和500条收藏。 */
export function retainIntelligence(userId: string, entries: IntelligenceEntry[]) {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const statement = connection.prepare(
      "INSERT INTO intelligence_entries(user_id,id,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
    );
    for (const entry of entries) statement.run(userId, entry.id, JSON.stringify(entry), Date.now());
    connection
      .prepare(
        "DELETE FROM intelligence_entries WHERE user_id=? AND saved=0 AND id NOT IN (SELECT id FROM intelligence_entries WHERE user_id=? AND saved=0 ORDER BY updated_at DESC,id DESC LIMIT 3000)",
      )
      .run(userId, userId);
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

/** 只修改当前账号已验证存在的情报状态，拒绝客户端制造公开标题或关联他人记录。 */
export function updateIntelligence(
  userId: string,
  id: string,
  action: "read" | "saved",
  value: boolean,
) {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const row = connection
      .prepare("SELECT saved FROM intelligence_entries WHERE user_id=? AND id=?")
      .get(userId, id) as
      | {
          /** SQLite 收藏状态，1为已收藏、0为未收藏。 */
          saved: number;
        }
      | undefined;
    if (!row) throw new HttpError("情报记录不存在，请先加载列表", 404);
    if (action === "saved" && value && !row.saved) {
      const count = connection
        .prepare("SELECT COUNT(*) AS count FROM intelligence_entries WHERE user_id=? AND saved=1")
        .get(userId) as {
        /** 当前账号已收藏情报的整数条数，用于校验500条上限。 */
        count: number;
      };
      if (count.count >= 500) throw new HttpError("每个账号最多收藏500条情报，请先取消部分收藏");
    }
    if (action === "read")
      connection
        .prepare("UPDATE intelligence_entries SET read_at=? WHERE user_id=? AND id=?")
        .run(value ? Date.now() : null, userId, id);
    else
      connection
        .prepare("UPDATE intelligence_entries SET saved=? WHERE user_id=? AND id=?")
        .run(value ? 1 : 0, userId, id);
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
