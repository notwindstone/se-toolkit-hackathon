import { Database, Statement } from "bun:sqlite";
import { db } from "./database";

export interface HealthCheck {
  id: number;
  target_id: number;
  status: "up" | "down";
  response_time_ms: number | null;
  error: string | null;
  checked_at: string;
}

const insertStmt = db.prepare(
  "INSERT INTO health_checks (target_id, status, response_time_ms, error) VALUES (?, ?, ?, ?)"
) as Statement<any, [number, string, number | null, string | null]>;

const getRecentStmt = db.prepare(
  "SELECT * FROM health_checks WHERE target_id = ? ORDER BY checked_at DESC LIMIT ?"
) as Statement<HealthCheck, [number, number]>;

const getUptimeStmt = db.prepare(
  "SELECT ROUND(100.0 * SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) / COUNT(*), 2) as uptime_percent FROM health_checks WHERE target_id = ?"
) as Statement<{ uptime_percent: number | null }, [number]>;

export const healthCheckRepo = {
  log(data: { target_id: number; status: "up" | "down"; response_time_ms?: number | null; error?: string | null }): HealthCheck {
    insertStmt.run(data.target_id, data.status, data.response_time_ms ?? null, data.error ?? null);
    const row = db.query("SELECT last_insert_rowid() as id").get();
    return this.getById(row.id)!;
  },

  getRecentByTarget(targetId: number, limit = 50): HealthCheck[] {
    return getRecentStmt.all(targetId, limit);
  },

  getUptimePercent(targetId: number): number {
    const row = getUptimeStmt.get(targetId);
    return row?.uptime_percent ?? 0;
  },

  getById(id: number): HealthCheck | null {
    const stmt = db.prepare("SELECT * FROM health_checks WHERE id = ?") as Statement<HealthCheck, [number]>;
    return stmt.get(id) ?? null;
  },
};
