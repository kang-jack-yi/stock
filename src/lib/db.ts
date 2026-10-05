import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const globalDb = globalThis as typeof globalThis & { stockDb?: DatabaseSync };
/** 使用 Node 自带 SQLite；数据库仅在服务端创建，WAL 允许并发读取。 */
export function db() {
  if (globalDb.stockDb) return globalDb.stockDb;
  // 数据库在运行时创建；禁止构建器将动态路径对应的工作目录打包为静态依赖。
  const file = resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || "./data/stock.db");
  mkdirSync(dirname(file), { recursive: true });
  const connection = new DatabaseSync(file);
  connection.exec(
    "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
  );
  connection.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY (user_id, symbol)
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  `);
  globalDb.stockDb = connection;
  return connection;
}
