import { Elysia } from "elysia";

import log from "@/utils/log";
import { apiRoutes } from "@/routes/api";
import { setOnCheckCallback, startScheduler } from "@/checker/scheduler";
import {
  initBot,
  startBotInstance,
  notifyDown,
  notifyInvestigation,
  notifyUp,
} from "@/bot/telegram";
import type { Target } from "@/db/targets";
import type { CheckResult } from "@/checker/checkers";
import cors from "@elysiajs/cors";
import { investigateFailure } from "@/investigator";

// Load .env from package directory if not already set
async function loadEnvFromFile(): Promise<void> {
  if (process.env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  log.info("Directly reading environmental variables");

  try {
    const envFile = await Bun.file(new URL(".env", import.meta.url)).text();

    for (const line of envFile.split("\n")) {
      const trimmed = line.trim();

      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...rest] = trimmed.split("=");
        const val = rest.join("=").replace(/^["']|["']$/g, "");

        process.env[key.trim()] = val;
      }
    }
  } catch {
    log.error("Error while directly reading environmental variables");
  }
}

await loadEnvFromFile();

const DOWN_NOTIFICATION_THRESHOLD = 3;
// Track consecutive down checks per target.
const consecutiveDownChecks = new Map<number, number>();
// Track whether a down alert was already sent for a target.
const alertedDownTargets = new Set<number>();

// Load env
const PORT = Number(process.env.PORT ?? 3000);
const adminUserId = process.env.ADMIN_USER_ID ?? process.env.ADMIN_CHAT_ID;
const notificationChatId = process.env.NOTIFICATION_CHAT_ID;

// Init bot (if configured)
const bot = initBot(process.env.TELEGRAM_BOT_TOKEN, adminUserId, notificationChatId);

// Setup check callback for notifications
setOnCheckCallback((target: Target, result: CheckResult) => {
  const current = result.status;

  if (current === "down") {
    const downCount = (consecutiveDownChecks.get(target.id) ?? 0) + 1;

    consecutiveDownChecks.set(target.id, downCount);

    if (downCount >= DOWN_NOTIFICATION_THRESHOLD && !alertedDownTargets.has(target.id)) {
      alertedDownTargets.add(target.id);
      notifyDown(target, result.error ?? "Unknown error");
      void investigateFailure(target, result)
        .then((report) => {
          if (report) {
            return notifyInvestigation(target, report);
          }
        })
        .catch((err) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          log.error(`INVESTIGATOR | Unhandled error for ${target.name}: ${errorMessage}`);
        });
    }

    return;
  }

  consecutiveDownChecks.set(target.id, 0);

  if (alertedDownTargets.has(target.id)) {
    alertedDownTargets.delete(target.id);
    notifyUp(target);
  }
});

// Build Elysia app
const app = new Elysia()
  .use(apiRoutes)
  .use(cors())
  .get("/", () => ({
    "name"   : "Yesod",
    "version": "0.1.0",
    "endpoints": {
      "targets": "/api/targets",
      "status" : "/api/status",
    },
  }))
  .listen(PORT);

log.info(`Yesod API running on http://localhost:${PORT}`);

// Start scheduler
startScheduler();

// Start bot
if (bot) {
  startBotInstance();
}
