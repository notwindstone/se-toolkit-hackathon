import { Bot, Context, session, SessionFlavor } from "grammy";
import { targetRepo } from "../db/targets";
import { healthCheckRepo } from "../db/healthChecks";
import type { Target } from "../db/targets";
import log from "../utils/log";

let botInstance: Bot | null = null;
let adminChatId: number | null = null;

function statusEmoji(status: string | null): string {
  if (status === "up") return "🟢";
  if (status === "down") return "🔴";
  return "⚪";
}

function createBot(token: string) {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Welcome to Kether - a VDS monitoring assistant.\n\n" +
      "Available commands:\n" +
      "/status - Show all monitored targets\n" +
      "/uptime - Show uptime statistics\n\n" +
      "I will also notify you automatically when something goes down.",
      { parse_mode: "Markdown" }
    );
  });

  bot.command("status", async (ctx) => {
    const targets = targetRepo.getAllIncludingDisabled();
    if (targets.length === 0) {
      await ctx.reply("📭 No targets configured. Add targets via the API or dashboard.");
      return;
    }

    const lines = targets.map((t: Target) => {
      const lastCheck = healthCheckRepo.getRecentByTarget(t.id, 1)[0] ?? null;
      const enabled = t.enabled ? "" : " _(disabled)_";
      const status = lastCheck?.status ?? null;
      const error = lastCheck?.error ? `\n    └ ${lastCheck.error}` : "";
      return `${statusEmoji(status)} *${t.name}* (${t.type})${enabled}${error}`;
    });

    await ctx.reply(
      "📊 **Monitoring Status**\n\n" + lines.join("\n"),
      { parse_mode: "Markdown" }
    );
  });

  bot.command("uptime", async (ctx) => {
    const targets = targetRepo.getAllIncludingDisabled();
    if (targets.length === 0) {
      await ctx.reply("📭 No targets configured.");
      return;
    }

    const lines = targets.map((t: Target) => {
      const uptime = healthCheckRepo.getUptimePercent(t.id);
      return `📈 *${t.name}*: ${uptime}%`;
    });

    await ctx.reply(
      "⏱ **Uptime Statistics**\n\n" + lines.join("\n"),
      { parse_mode: "Markdown" }
    );
  });

  return bot;
}

export function initBot(token?: string, chatIdStr?: string) {
  if (!token || !chatIdStr) {
    log.warn("BOT | TELEGRAM_BOT_TOKEN or ADMIN_CHAT_ID are not set; bot was disabled");
    return null;
  }

  adminChatId = Number(chatIdStr);
  botInstance = createBot(token);
  log.info(`BOT | Initialized, chatting with ${adminChatId}`);
  return botInstance;
}

export async function startBotInstance() {
  if (!botInstance) return;
  const info = await botInstance.api.getMe();
  log.info(`BOT | Running as @${info.username}`);
  await botInstance.start();
}

export async function notifyDown(target: Target, error: string) {
  if (!botInstance || !adminChatId) return;

  const message = `🚨 **ALERT**\n\n` +
    `*${target.name}* (${target.type}) is **DOWN**\n` +
    `URL: \`${target.url}${target.port ? `:${target.port}` : ""}\`\n` +
    `Error: \`${error}\``;

  try {
    await botInstance.api.sendMessage(adminChatId, message, { parse_mode: "Markdown" });
  } catch (err) {
    log.error("BOT | Failed to send notification:", err);
  }
}

export async function notifyUp(target: Target) {
  if (!botInstance || !adminChatId) return;

  const message = `✅ **RECOVERED**\n\n` +
    `*${target.name}* (${target.type}) is back **UP**`;

  try {
    await botInstance.api.sendMessage(adminChatId, message, { parse_mode: "Markdown" });
  } catch (err) {
    log.error("BOT | Failed to send notification:", err);
  }
}
