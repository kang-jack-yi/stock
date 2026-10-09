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
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL, metric TEXT NOT NULL, direction TEXT NOT NULL, threshold REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, previous_value REAL, previous_at TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS alert_rules_user ON alert_rules(user_id);
    CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY, rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT NOT NULL, name TEXT NOT NULL,
      metric TEXT NOT NULL, direction TEXT NOT NULL, threshold REAL NOT NULL, value REAL NOT NULL,
      quote_at TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS alert_events_user ON alert_events(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS worker_status (id TEXT PRIMARY KEY, checked_at INTEGER NOT NULL, message TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS saved_screeners (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, filters TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS saved_screeners_user ON saved_screeners(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS research_groups (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id,name)
    );
    CREATE INDEX IF NOT EXISTS research_groups_user ON research_groups(user_id);
    CREATE TABLE IF NOT EXISTS research_entries (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT NOT NULL,
      group_id TEXT REFERENCES research_groups(id) ON DELETE SET NULL, note TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]', review_date TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,symbol)
    );
    CREATE INDEX IF NOT EXISTS research_entries_user ON research_entries(user_id,position);
    CREATE TABLE IF NOT EXISTS portfolio_transactions (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, kind TEXT NOT NULL,
      symbol TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0, fee REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS portfolio_transactions_user ON portfolio_transactions(user_id,date,sequence);
    CREATE TABLE IF NOT EXISTS review_markets (date TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS review_accounts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL REFERENCES review_markets(date) ON DELETE CASCADE, payload TEXT NOT NULL,
      PRIMARY KEY(user_id,date)
    );
    CREATE INDEX IF NOT EXISTS review_accounts_date ON review_accounts(date);
  `);
  globalDb.stockDb = connection;
  return connection;
}
