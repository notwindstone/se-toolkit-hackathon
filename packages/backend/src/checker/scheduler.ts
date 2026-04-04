import log from "@/utils/log";
import { healthCheckRepo } from "@/db/healthChecks";
import { targetRepo, type Target } from "@/db/targets";
import { runCheck, type CheckResult } from "@/checker/checkers";

type OnCheckCallback = (target: Target, result: CheckResult) => void;

const intervals = new Map<number, ReturnType<typeof setInterval>>();
let onCheck: OnCheckCallback | null = null;

export function setOnCheckCallback(callback: OnCheckCallback): void {
  onCheck = callback;
}

function scheduleTarget(target: Target): void {
  const intervalMs = target.check_interval_seconds * 1000;

  const id = setInterval(async () => {
    const result = await runCheck(target);

    healthCheckRepo.log({
      "target_id"       : target.id,
      "status"          : result.status,
      "response_time_ms": result.response_time_ms,
      "error"           : result.error,
    });

    if (onCheck) {
      onCheck(target, result);
    }
  }, intervalMs);

  intervals.set(target.id, id);
}

export function startScheduler(): void {
  stopScheduler();

  const targets = targetRepo.getAll();

  for (const target of targets) {
    scheduleTarget(target);
  }

  log.info(`Started monitoring ${targets.length} target(s)`);
}

export function stopScheduler(): void {
  for (const [, interval] of intervals) {
    clearInterval(interval);
  }

  intervals.clear();
}

export function addTargetToScheduler(target: Target): void {
  if (intervals.has(target.id)) {
    clearInterval(intervals.get(target.id)!);
    intervals.delete(target.id);
  }

  if (target.enabled) {
    scheduleTarget(target);
  }
}

export function removeTargetFromScheduler(targetId: number): void {
  const interval = intervals.get(targetId);

  if (interval) {
    clearInterval(interval);
    intervals.delete(targetId);
  }
}
