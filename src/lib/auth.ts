import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import type { User } from "./types";

export const SESSION_COOKIE = "guanlan_session";
export const SESSION_AGE = 7 * 24 * 60 * 60;
/** 计算会话令牌的 SHA-256 摘要，数据库只存摘要。 */
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
/** 清理过期会话并生成七天有效的随机令牌，仅向 Cookie 写入原始令牌。 */
export function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  db().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  db()
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(tokenHash(token), userId, Date.now() + SESSION_AGE * 1000);
  return token;
}
/** 通过 Next.js 异步 cookies 验证会话，未登录或已过期返回 null。 */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const record = db()
    .prepare(
      `SELECT users.id, users.email, users.name FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE token_hash = ? AND expires_at > ?`,
    )
    .get(tokenHash(token), Date.now()) as User | undefined;
  // node:sqlite 返回无原型对象；Server → Client props 必须是可序列化的普通对象。
  return record ? { id: record.id, email: record.email, name: record.name } : null;
}
/** 删除当前 Cookie 对应会话；调用方负责同时清除浏览器 Cookie。 */
export async function revokeSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}
