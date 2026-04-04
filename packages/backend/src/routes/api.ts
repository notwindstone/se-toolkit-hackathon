import { Elysia, t } from "elysia";
import { targetRepo } from "../db/targets";
import { healthCheckRepo } from "../db/healthChecks";
import { startScheduler, addTargetToScheduler, removeTargetFromScheduler } from "../checker/scheduler";

export const apiRoutes = new Elysia({ prefix: "/api" })
  // GET /api/targets — list all targets
  .get("/targets", () => {
    return targetRepo.getAllIncludingDisabled();
  })

  // POST /api/targets — add a new target
  .post(
    "/targets",
    ({ body }) => {
      const target = targetRepo.create(body);
      addTargetToScheduler(target);
      return target;
    },
    {
      body: t.Object({
        type: t.Union([t.Literal("http"), t.Literal("postgres")]),
        name: t.String({ minLength: 1 }),
        url: t.String({ minLength: 1 }),
        port: t.Optional(t.Number()),
        check_interval_seconds: t.Optional(t.Number({ minimum: 1 })),
      }),
    }
  )

  // PATCH /api/targets/:id — update a target
  .patch(
    "/targets/:id",
    ({ params, body }) => {
      const id = Number(params.id);
      targetRepo.update(id, body);
      const updated = targetRepo.getById(id)!;
      addTargetToScheduler(updated);
      return updated;
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({
        type: t.Optional(t.Union([t.Literal("http"), t.Literal("postgres")])),
        name: t.Optional(t.String()),
        url: t.Optional(t.String()),
        port: t.Optional(t.Number()),
        check_interval_seconds: t.Optional(t.Number()),
        enabled: t.Optional(t.Boolean()),
      }),
    }
  )

  // DELETE /api/targets/:id — remove a target
  .delete(
    "/targets/:id",
    ({ params }) => {
      const id = Number(params.id);
      removeTargetFromScheduler(id);
      targetRepo.delete(id);
      return { ok: true };
    },
    {
      params: t.Object({ id: t.Numeric() }),
    }
  )

  // GET /api/targets/:id/checks — recent checks for a target
  .get(
    "/targets/:id/checks",
    ({ params, query }) => {
      const id = Number(params.id);
      const limit = query?.limit ? Number(query.limit) : 50;
      return healthCheckRepo.getRecentByTarget(id, limit);
    },
    {
      params: t.Object({ id: t.Numeric() }),
      query: t.Optional(
        t.Object({ limit: t.Optional(t.Numeric()) })
      ),
    }
  )

  // GET /api/status — current status of all targets (last check result)
  .get("/status", () => {
    const targets = targetRepo.getAllIncludingDisabled();
    return targets.map((target) => {
      const lastCheck = healthCheckRepo.getRecentByTarget(target.id, 1)[0] ?? null;
      const uptime = healthCheckRepo.getUptimePercent(target.id);
      return {
        id: target.id,
        name: target.name,
        type: target.type,
        enabled: !!target.enabled,
        last_status: lastCheck?.status ?? null,
        last_checked_at: lastCheck?.checked_at ?? null,
        last_response_time_ms: lastCheck?.response_time_ms ?? null,
        last_error: lastCheck?.error ?? null,
        uptime_percent: uptime,
      };
    });
  });
