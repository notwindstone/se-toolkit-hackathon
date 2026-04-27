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

// Track previous status per target to avoid spam
const previousStatus = new Map<number, "up" | "down">();

// Load env
const PORT = Number(process.env.PORT ?? 3000);
const adminUserId = process.env.ADMIN_USER_ID ?? process.env.ADMIN_CHAT_ID;
const notificationChatId = process.env.NOTIFICATION_CHAT_ID;

// Init bot (if configured)
const bot = initBot(process.env.TELEGRAM_BOT_TOKEN, adminUserId, notificationChatId);

// Setup check callback for notifications
setOnCheckCallback((target: Target, result: CheckResult) => {
  const prev = previousStatus.get(target.id);
  const current = result.status;

  if (prev !== "down" && current === "down") {
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
  } else if (prev === "down" && current === "up") {
    notifyUp(target);
  }

  previousStatus.set(target.id, current);
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
