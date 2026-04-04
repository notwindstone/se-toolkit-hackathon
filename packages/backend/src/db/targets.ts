import { Database, Statement } from "bun:sqlite";
import { db } from "./database";

export interface Target {
  id: number;
  type: "http" | "postgres";
  name: string;
  url: string;
  port: number | null;
  check_interval_seconds: number;
  enabled: boolean;
  created_at: string;
}

export interface CreateTargetDTO {
  type: "http" | "postgres";
  name: string;
  url: string;
  port?: number;
  check_interval_seconds?: number;
}

// Prepared statements
const insertStmt = db.prepare(
  "INSERT INTO targets (type, name, url, port, check_interval_seconds) VALUES (?, ?, ?, ?, ?)"
) as Statement<any, [string, string, string, number | null, number]>;

const getAllStmt = db.prepare("SELECT * FROM targets WHERE enabled = 1") as Statement<Target>;

const getAllIncludingDisabledStmt = db.prepare("SELECT * FROM targets") as Statement<Target>;

const getByIdStmt = db.prepare("SELECT * FROM targets WHERE id = ?") as Statement<Target, [number]>;

const updateStmt = db.prepare(`
  UPDATE targets
  SET type = COALESCE(?, type),
      name = COALESCE(?, name),
      url = COALESCE(?, url),
      port = COALESCE(?, port),
      check_interval_seconds = COALESCE(?, check_interval_seconds),
      enabled = COALESCE(?, enabled)
  WHERE id = ?
`) as Statement<any, [string | null, string | null, string | null, number | null, number | null, number | null, number]>;

const deleteStmt = db.prepare("DELETE FROM targets WHERE id = ?") as Statement<any, [number]>;

export const targetRepo = {
  create(data: CreateTargetDTO): Target {
    insertStmt.run(data.type, data.name, data.url, data.port ?? null, data.check_interval_seconds ?? 3600);
    return this.getById(db.query("SELECT last_insert_rowid() as id").get().id)!;
  },

  getAll(): Target[] {
    return getAllStmt.all();
  },

  getAllIncludingDisabled(): Target[] {
    return getAllIncludingDisabledStmt.all();
  },

  getById(id: number): Target | null {
    return getByIdStmt.get(id) ?? null;
  },

  update(id: number, data: Partial<CreateTargetDTO> & { enabled?: boolean }): void {
    updateStmt.run(
      data.type ?? null,
      data.name ?? null,
      data.url ?? null,
      data.port ?? null,
      data.check_interval_seconds ?? null,
      data.enabled === undefined ? null : (data.enabled ? 1 : 0),
      id
    );
  },

  delete(id: number): void {
    deleteStmt.run(id);
  },
};
