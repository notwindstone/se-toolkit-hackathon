import { Elysia } from "elysia";
import log from "./utils/log";
import { $ } from "bun";

// Load .env from package directory if not already set
if (!process.env.TELEGRAM_BOT_TOKEN) {
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

// db/database.ts self-initializes on import
import { apiRoutes } from "./routes/api";
import { setOnCheckCallback } from "./checker/scheduler";
import { startScheduler } from "./checker/scheduler";
import { initBot, startBotInstance, notifyDown, notifyUp } from "./bot/telegram";
import type { Target } from "./db/targets";

// Track previous status per target to avoid spam
const previousStatus = new Map<number, "up" | "down">();

// Load env
const PORT = Number(process.env.PORT ?? 3000);

// Init bot (if configured)
const bot = initBot(process.env.TELEGRAM_BOT_TOKEN, process.env.ADMIN_CHAT_ID);

// Setup check callback for notifications
setOnCheckCallback((target: Target, result) => {
  const prev = previousStatus.get(target.id);
  const current = result.status;

  if (prev !== "down" && current === "down") {
    notifyDown(target, result.error ?? "Unknown error");
  } else if (prev === "down" && current === "up") {
    notifyUp(target);
  }

  previousStatus.set(target.id, current);
});

// Build Elysia app
const app = new Elysia()
  .use(apiRoutes)
  .get("/", () => ({
    name: "Kether",
    version: "0.1.0",
    endpoints: {
      targets: "/api/targets",
      status: "/api/status",
    },
  }))
  .listen(PORT);

log.info(`Kether API running on http://localhost:${PORT}`);

// Start scheduler
startScheduler();

// Start bot
if (bot) {
  startBotInstance();
}
