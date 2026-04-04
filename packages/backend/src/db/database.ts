import { Database } from "bun:sqlite";
import path from "path";

import log from "@/utils/log";

const DB_PATH = path.join(
  process.cwd(),
  process.env.DATABASE_PATH ?? "chesed.db",
);

export const db: Database = new Database(DB_PATH);

export function initDatabase(): void {
  log.debug("Initializing database with WAL mode and foreign keys");

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('http', 'postgres')),
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      port INTEGER,
      check_interval_seconds INTEGER NOT NULL DEFAULT 3600,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS health_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('up', 'down')),
      response_time_ms INTEGER,
      error TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_health_checks_target
      ON health_checks(target_id, checked_at DESC);
  `);

  log.debug("Database tables initialized successfully");
}

initDatabase();
