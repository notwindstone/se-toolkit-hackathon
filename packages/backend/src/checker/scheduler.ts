import { targetRepo, type Target } from "../db/targets";
import { healthCheckRepo } from "../db/healthChecks";
import { runCheck } from "./checkers";

type OnCheckCallback = (target: Target, result: Awaited<ReturnType<typeof runCheck>>) => void;

const intervals = new Map<number, ReturnType<typeof setInterval>>();
let onCheck: OnCheckCallback | null = null;

export function setOnCheckCallback(callback: OnCheckCallback) {
  onCheck = callback;
}

function scheduleTarget(target: Target) {
  const intervalMs = target.check_interval_seconds * 1000;

  const id = setInterval(async () => {
    const result = await runCheck(target);
    healthCheckRepo.log({
      target_id: target.id,
      status: result.status,
      response_time_ms: result.response_time_ms,
      error: result.error,
    });

    if (onCheck) {
      onCheck(target, result);
    }
  }, intervalMs);

  intervals.set(target.id, id);
}

export function startScheduler() {
  // Clear any existing intervals
  stopScheduler();

  const targets = targetRepo.getAll();
  for (const target of targets) {
    scheduleTarget(target);
  }

  console.log(`[scheduler] Started monitoring ${targets.length} target(s)`);
}

export function stopScheduler() {
  for (const [targetId, interval] of intervals) {
    clearInterval(interval);
  }
  intervals.clear();
}

export function addTargetToScheduler(target: Target) {
  if (intervals.has(target.id)) {
    clearInterval(intervals.get(target.id)!);
    intervals.delete(target.id);
  }
  if (target.enabled) {
    scheduleTarget(target);
  }
}

export function removeTargetFromScheduler(targetId: number) {
  const interval = intervals.get(targetId);
  if (interval) {
    clearInterval(interval);
    intervals.delete(targetId);
  }
}
