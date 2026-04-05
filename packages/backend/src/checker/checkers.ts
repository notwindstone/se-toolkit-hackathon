import pg from "pg";

import type { Target } from "@/db/targets";

export interface CheckResult {
  "status": "up" | "down";
  "response_time_ms": number;
  "error": string | null;
}

function hasScheme(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url);
}

function buildHttpCandidates(rawUrl: string): string[] {
  const trimmed = rawUrl.trim();

  if (hasScheme(trimmed)) {
    return [trimmed];
  }

  return [`https://${trimmed}`, `http://${trimmed}`];
}

export async function checkHttp(target: Target): Promise<CheckResult> {
  const start = Date.now();
  const candidates = buildHttpCandidates(target.url);
  let lastError: string | null = null;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        "method"  : "GET",
        "redirect": "follow",
        "signal"  : AbortSignal.timeout(10_000),
      });

      const elapsed = Date.now() - start;
      const ok = response.status >= 200 && response.status < 400;

      return {
        "status"          : ok ? "up" : "down",
        "response_time_ms": elapsed,
        "error"           : ok ? null : `HTTP ${response.status}`,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  const elapsed = Date.now() - start;

  return {
    "status"         : "down",
    "response_time_ms": elapsed,
    "error"          : lastError ?? "Failed to fetch target URL",
  };
}

export async function checkPostgres(target: Target): Promise<CheckResult> {
  const start = Date.now();
  const client = new pg.Client({
    "host"                  : target.url,
    "port"                  : target.port ?? 5432,
    "connectionTimeoutMillis": 10_000,
  });

  try {
    await client.connect();
    await client.query("SELECT 1");

    const elapsed = Date.now() - start;

    return {
      "status"         : "up",
      "response_time_ms": elapsed,
      "error"          : null,
    };
  } catch (err) {
    const elapsed = Date.now() - start;

    return {
      "status"         : "down",
      "response_time_ms": elapsed,
      "error"          : err instanceof Error ? err.message : String(err),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function runCheck(target: Target): Promise<CheckResult> {
  switch (target.type) {
    case "http": {
      return checkHttp(target);
    }
    case "postgres": {
      return checkPostgres(target);
    }
    default: {
      return {
        "status"         : "down",
        "response_time_ms": 0,
        "error"          : `Unknown target type: ${target.type}`,
      };
    }
  }
}
