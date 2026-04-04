import type { Database, Statement } from "bun:sqlite";

import { db } from "@/db/database";

export interface Target {
  "id": number;
  "type": "http" | "postgres";
  "name": string;
  "url": string;
  "port": number | null;
  "check_interval_seconds": number;
  "enabled": boolean;
  "created_at": string;
}

export interface CreateTargetDTO {
  "type": "http" | "postgres";
  "name": string;
  "url": string;
  "port"?: number;
  "check_interval_seconds"?: number;
}

const insertStmt = db.prepare(
  "INSERT INTO targets (type, name, url, port, check_interval_seconds) VALUES (?, ?, ?, ?, ?)",
) as Statement<never, [string, string, string, number | null, number]>;

const getAllStmt = db.prepare(
  "SELECT * FROM targets WHERE enabled = 1",
) as Statement<Target>;

const getAllIncludingDisabledStmt = db.prepare(
  "SELECT * FROM targets",
) as Statement<Target>;

const getByIdStmt = db.prepare(
  "SELECT * FROM targets WHERE id = ?",
) as Statement<Target, [number]>;

const updateStmt = db.prepare(`
  UPDATE targets
  SET type = COALESCE(?, type),
      name = COALESCE(?, name),
      url = COALESCE(?, url),
      port = COALESCE(?, port),
      check_interval_seconds = COALESCE(?, check_interval_seconds),
      enabled = COALESCE(?, enabled)
  WHERE id = ?
`) as Statement<never, [string | null, string | null, string | null, number | null, number | null, number | null, number]>;

const deleteStmt = db.prepare(
  "DELETE FROM targets WHERE id = ?",
) as Statement<never, [number]>;

function getLastInsertId(): number {
  const row = db.query("SELECT last_insert_rowid() as id").get() as { "id": number };
  return row.id;
}

export function createTarget(data: CreateTargetDTO): Target {
  insertStmt.run(
    data.type,
    data.name,
    data.url,
    data.port ?? null,
    data.check_interval_seconds ?? 3600,
  );

  return getById(getLastInsertId())!;
}

export function getAllTargets(): Array<Target> {
  return getAllStmt.all();
}

export function getAllTargetsIncludingDisabled(): Array<Target> {
  return getAllIncludingDisabledStmt.all();
}

export function getById(id: number): Target | null {
  return getByIdStmt.get(id) ?? null;
}

export function updateTarget(
  id: number,
  data: Partial<CreateTargetDTO> & { "enabled"?: boolean },
): void {
  updateStmt.run(
    data.type ?? null,
    data.name ?? null,
    data.url ?? null,
    data.port ?? null,
    data.check_interval_seconds ?? null,
    data.enabled === undefined ? null : (data.enabled ? 1 : 0),
    id,
  );
}

export function deleteTarget(id: number): void {
  deleteStmt.run(id);
}

export const targetRepo = {
  "create"                  : createTarget,
  "getAll"                  : getAllTargets,
  "getAllIncludingDisabled" : getAllTargetsIncludingDisabled,
  "getById"                 : getById,
  "update"                  : updateTarget,
  "delete"                  : deleteTarget,
} as const;
