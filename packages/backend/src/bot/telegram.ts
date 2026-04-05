import { Bot, type Context } from "grammy";

import log from "@/utils/log";
import { targetRepo, type Target } from "@/db/targets";
import { healthCheckRepo } from "@/db/healthChecks";

let botInstance: Bot | null = null;
let adminChatId: number | null = null;

function getStatus(status: string | null): string {
  if (status === "up") {
    return "🟩 Up";
  }

  if (status === "down") {
    return "🟥 Down";
  }

  return "⬜ Unknown";
}

const timeFormat = { "hour": "2-digit", "minute": "2-digit", "second": "2-digit" } as const;

function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Welcome to Yesod - a VDS monitoring assistant.\n" +
      "\n" +
      "Available commands:\n" +
      "/status - Show all monitored targets\n" +
      "/uptime - Show uptime statistics\n" +
      "\n" +
      "I will also send a message automatically when something goes down.",
      { "parse_mode": "Markdown" },
    );
  });

  bot.command("status", async (ctx) => {
    const targets = targetRepo.getAllIncludingDisabled();

    if (targets.length === 0) {
      await ctx.reply("No targets configured yet. You can add them here (/add_target), via Dashboard, or through API.");

      return;
    }

    const lines = targets.map((t: Target) => {
      const lastCheck = healthCheckRepo.getRecentByTarget(t.id, 1)[0] ?? null;
      const uptime = healthCheckRepo.getUptimePercent(t.id);
      const enabled = t.enabled ? "" : " _(disabled)_";
      const status = lastCheck?.status ?? null;
      const error = lastCheck?.error ? `\nError      | ${lastCheck.error}` : "";

      const lastCheckTime = new Date(lastCheck.checked_at ?? "Never");
      const nextCheckTime = lastCheck
        ? new Date(lastCheckTime.getTime() + t.check_interval_seconds * 1000)
            .toLocaleTimeString([], timeFormat)
        : "Scheduled";

      return (
        String.raw`ID         | ${t.id}` + "\n" +
        String.raw`Name       | ${t.name}` + "\n" +
        String.raw`Status     | ${getStatus(status)}` + "\n" +
        String.raw`URL        | ${t.url} ${enabled}${error}` + "\n" +
        String.raw`Uptime     | ${uptime}%` + "\n" +
        String.raw`Last Check | ${lastCheckTime.toLocaleTimeString([], timeFormat)}` + "\n" +
        String.raw`Next Check | ${nextCheckTime} | Every ${t.check_interval_seconds} seconds` + "\n"
      );
    });

    await ctx.reply(
      (
        "Service statuses:\n" + 
        "\n" +
        "```markdown\n" + lines.join("\n") + "\n```"
      ),
      { "parse_mode": "Markdown" },
    );
  });

  bot.command("uptime", async (ctx) => {
    const targets = targetRepo.getAllIncludingDisabled();

    if (targets.length === 0) {
      await ctx.reply("No targets configured yet. You can add them here (/add_target), via Dashboard, or through API.");

      return;
    }

    const lines: Array<string> = [];

    for (const target of targets) {
      const recentChecks = healthCheckRepo.getRecentByTarget(target.id, 10);

      if (recentChecks.length === 0) {
        lines.push("No checks yet\n");

        continue;
      }

      const checkLines = recentChecks.map((check, index) => {
        const time = new Date(check.checked_at).toLocaleTimeString([], timeFormat);
        const statusMarker = check.status === "up" ? "🟩 Up" : "🟥 Down";

        return `Check ${(index + 1).toString().padEnd(4)} | ${statusMarker} at ${time}`;
      });

      const uptime = healthCheckRepo.getUptimePercent(target.id);

      lines.push(`Name       | ${target.name}`);
      lines.push(`URL        | ${target.url}`);
      lines.push(`Uptime     | ${uptime}%`);
      lines.push(checkLines.join("\n") + "\n");
    }

    await ctx.reply(
      (
        "Last 10 checks per target:\n" +
        "\n" +
        "```markdown\n" + lines.join("\n") + "\n```"
      ),
      { "parse_mode": "Markdown" },
    );
  });

  return bot;
}

export function initBot(token?: string, chatIdStr?: string): Bot | null {
  if (!token || !chatIdStr) {
    log.warn("BOT | TELEGRAM_BOT_TOKEN or ADMIN_CHAT_ID are not set; bot was disabled");

    return null;
  }

  adminChatId = Number(chatIdStr);
  botInstance = createBot(token);
  log.info(`BOT | Initialized, chatting with ${adminChatId}`);

  return botInstance;
}

export async function startBotInstance(): Promise<void> {
  if (!botInstance) {
    return;
  }

  const info = await botInstance.api.getMe();

  log.info(`BOT | Running as @${info.username}`);
  await botInstance.start();
}

export async function notifyDown(target: Target, error: string): Promise<void> {
  if (!botInstance || !adminChatId) {
    return;
  }

  const message = "🚨 **ALERT**\n\n" +
    `*${target.name}* (${target.type}) is **DOWN**\n` +
    `URL: \`${target.url}${target.port ? `:${target.port}` : ""}\`\n` +
    `Error: \`${error}\``;

  try {
    await botInstance.api.sendMessage(adminChatId, message, { "parse_mode": "Markdown" });
  } catch (err) {
    log.error("BOT | Failed to send notification:", err);
  }
}

export async function notifyUp(target: Target): Promise<void> {
  if (!botInstance || !adminChatId) {
    return;
  }

  const message = "✅ **RECOVERED**\n\n" +
    `*${target.name}* (${target.type}) is back **UP**`;

  try {
    await botInstance.api.sendMessage(adminChatId, message, { "parse_mode": "Markdown" });
  } catch (err) {
    log.error("BOT | Failed to send notification:", err);
  }
}
