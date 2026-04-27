import { Bot, type Context } from "grammy";

import log from "@/utils/log";
import { targetRepo, type Target, type CreateTargetDTO } from "@/db/targets";
import { healthCheckRepo } from "@/db/healthChecks";
import { addTargetToScheduler, removeTargetFromScheduler } from "@/checker/scheduler";

let botInstance: Bot | null = null;
let adminUserId: number | null = null;
let notificationChatId: number | null = null;

type AddTargetStep = "name" | "type" | "url" | "port" | "interval";
type SendMessageOptions = { "parse_mode"?: "Markdown" | "MarkdownV2" | "HTML" };

interface PendingTarget extends Partial<CreateTargetDTO> {
  "step": AddTargetStep;
}

// Store pending target data for multi-step add command.
const pendingTargets = new Map<string, PendingTarget>();
// Store target IDs pending deletion for confirmation.
const pendingDeletions = new Set<number>();

function getStatus(status: string | null): string {
  if (status === "up") {
    return "\u{1F7E9} Up";
  }

  if (status === "down") {
    return "\u{1F7E5} Down";
  }

  return "\u{2B1C} Unknown";
}

const timeFormat = { "hour": "2-digit", "minute": "2-digit", "second": "2-digit" } as const;

function parseId(rawValue: string | undefined, envKey: string): number | null {
  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue.trim());

  if (!Number.isInteger(parsed)) {
    log.warn(`BOT | Invalid ${envKey}: "${rawValue}"`);

    return null;
  }

  return parsed;
}

function getSessionKey(ctx: Context): string | null {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (userId === undefined || chatId === undefined) {
    return null;
  }

  return `${chatId}:${userId}`;
}

function getNotificationRecipientIds(): Array<number> {
  const recipients = new Set<number>();

  if (adminUserId !== null) {
    recipients.add(adminUserId);
  }

  if (notificationChatId !== null) {
    recipients.add(notificationChatId);
  }

  return Array.from(recipients);
}

async function sendToRecipients(message: string, options?: SendMessageOptions): Promise<void> {
  if (!botInstance) {
    return;
  }

  const recipients = getNotificationRecipientIds();

  if (recipients.length === 0) {
    return;
  }

  await Promise.all(
    recipients.map(async (chatId) => {
      try {
        await botInstance!.api.sendMessage(chatId, message, options);
      } catch (err) {
        log.error(`BOT | Failed to send message to ${chatId}:`, err);
      }
    }),
  );
}

async function ensureCommandAccess(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  const chat = ctx.chat;

  if (userId === undefined || !chat) {
    await ctx.reply("Could not identify user or chat.");

    return false;
  }

  if (chat.type === "private") {
    if (adminUserId === null) {
      await ctx.reply("Private commands are disabled: ADMIN_USER_ID is not configured.");

      return false;
    }

    if (userId !== adminUserId) {
      await ctx.reply("You are not allowed to use this bot.");

      return false;
    }

    return true;
  }

  if (chat.type !== "group" && chat.type !== "supergroup") {
    await ctx.reply("Commands are only supported in private chats and groups.");

    return false;
  }

  try {
    const member = await ctx.api.getChatMember(chat.id, userId);

    if (member.status === "creator" || member.status === "administrator") {
      return true;
    }
  } catch (err) {
    log.error(`BOT | Failed to check admin role in chat ${chat.id}:`, err);
    await ctx.reply("Could not verify your admin role right now.");

    return false;
  }

  await ctx.reply("Only chat admins can use commands in this chat.");

  return false;
}

function protectedCommand(
  handler: (ctx: Context) => Promise<void>,
): (ctx: Context) => Promise<void> {
  return async (ctx: Context) => {
    if (!(await ensureCommandAccess(ctx))) {
      return;
    }

    await handler(ctx);
  };
}

async function handleAddTargetMessage(ctx: Context): Promise<void> {
  const sessionKey = getSessionKey(ctx);

  if (!sessionKey) {
    return;
  }

  const pending = pendingTargets.get(sessionKey);

  if (!pending) {
    return;
  }

  const text = ctx.msg?.text;

  if (!text) {
    return;
  }

  switch (pending.step) {
    case "name": {
      pending.name = text;
      pending.step = "type";
      pendingTargets.set(sessionKey, pending);

      await ctx.reply(
        "Now send the **type** (`http` or `postgres`):",
        { "parse_mode": "Markdown" },
      );

      break;
    }
    case "type": {
      if (text !== "http" && text !== "postgres") {
        await ctx.reply("Please send `http` or `postgres`.", { "parse_mode": "Markdown" });

        break;
      }

      pending.type = text;
      pending.step = "url";
      pendingTargets.set(sessionKey, pending);

      await ctx.reply(
        "Now send the **URL** (e.g., `https://example.com` or `localhost` for Postgres):",
        { "parse_mode": "Markdown" },
      );

      break;
    }
    case "url": {
      pending.url = text;
      pending.step = "port";
      pendingTargets.set(sessionKey, pending);

      await ctx.reply(
        "Now send the **port** (or `0` if not needed):",
        { "parse_mode": "Markdown" },
      );

      break;
    }
    case "port": {
      const port = Number(text);

      if (text !== "0" && isNaN(port)) {
        await ctx.reply("Please send a valid number.");

        break;
      }

      pending.port = port === 0 ? undefined : port;
      pending.step = "interval";
      pendingTargets.set(sessionKey, pending);

      await ctx.reply(
        "Finally, send the **check interval in seconds** (e.g., `60`):",
        { "parse_mode": "Markdown" },
      );

      break;
    }
    case "interval": {
      const interval = Number(text);

      if (isNaN(interval) || interval < 1) {
        await ctx.reply("Please send a valid number greater than 0.");

        break;
      }

      pending.check_interval_seconds = interval;
      pendingTargets.delete(sessionKey);

      try {
        const target = targetRepo.create(pending as CreateTargetDTO);

        addTargetToScheduler(target);

        await ctx.reply(
          (
            "\u{2705} Target added successfully!\n" +
            "\n" +
            "```markdown\n" +
            `Name       | ${target.name}\n` +
            `Type       | ${target.type}\n` +
            `URL        | ${target.url}\n` +
            `Port       | ${target.port ?? "N/A"}\n` +
            `Interval   | ${target.check_interval_seconds}s\n` +
            "```"
          ),
          { "parse_mode": "Markdown" },
        );
      } catch (err) {
        log.error("BOT | Failed to add target:", err);
        await ctx.reply("\u{274C} Failed to add target. Check logs for details.");
      }

      break;
    }
  }
}

function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", protectedCommand(async (ctx) => {
    await ctx.reply(
      "Welcome to Yesod - a VDS monitoring assistant.\n" +
      "\n" +
      "Available commands:\n" +
      "/status - Show all monitored targets\n" +
      "/uptime - Show uptime statistics\n" +
      "/addTarget - Add a new target to monitor\n" +
      "/delTarget - Delete a target by ID\n" +
      "\n" +
      "I will also send notifications automatically when something goes down.",
      { "parse_mode": "Markdown" },
    );
  }));

  bot.command("status", protectedCommand(async (ctx) => {
    const targets = targetRepo.getAllIncludingDisabled();

    if (targets.length === 0) {
      await ctx.reply("No targets configured yet. You can add them here (/addTarget), via Dashboard, or through API.");

      return;
    }

    const lines = targets.map((target: Target) => {
      const lastCheck = healthCheckRepo.getRecentByTarget(target.id, 1)[0] ?? null;
      const uptime = healthCheckRepo.getUptimePercent(target.id);
      const enabled = target.enabled ? "" : " _(disabled)_";
      const status = lastCheck?.status ?? null;
      const errorLine = lastCheck?.error ? `\nError      | ${lastCheck.error}` : "";
      const lastCheckDate = lastCheck ? new Date(lastCheck.checked_at) : null;
      const lastCheckTime = lastCheckDate
        ? lastCheckDate.toLocaleTimeString([], timeFormat)
        : "Never";
      const nextCheckTime = lastCheckDate
        ? new Date(lastCheckDate.getTime() + target.check_interval_seconds * 1000).toLocaleTimeString([], timeFormat)
        : "Scheduled";

      return (
        String.raw`ID         | ${target.id}` + "\n" +
        String.raw`Name       | ${target.name}` + "\n" +
        String.raw`Status     | ${getStatus(status)}` + "\n" +
        String.raw`URL        | ${target.url} ${enabled}${errorLine}` + "\n" +
        String.raw`Uptime     | ${uptime}%` + "\n" +
        String.raw`Last Check | ${lastCheckTime}` + "\n" +
        String.raw`Next Check | ${nextCheckTime} | Every ${target.check_interval_seconds} seconds` + "\n"
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
  }));

  bot.command("uptime", protectedCommand(async (ctx) => {
    const targets = targetRepo.getAllIncludingDisabled();

    if (targets.length === 0) {
      await ctx.reply("No targets configured yet. You can add them here (/addTarget), via Dashboard, or through API.");

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
        const statusMarker = check.status === "up" ? "\u{1F7E9} Up" : "\u{1F7E5} Down";

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
  }));

  bot.command("addTarget", protectedCommand(async (ctx) => {
    const sessionKey = getSessionKey(ctx);

    if (!sessionKey) {
      await ctx.reply("Could not identify user or chat.");

      return;
    }

    pendingTargets.set(sessionKey, { "step": "name" });

    await ctx.reply(
      "Let's add a new target. Please send the **name** of the target:",
      { "parse_mode": "Markdown" },
    );
  }));

  bot.command("delTarget", protectedCommand(async (ctx) => {
    const args = typeof ctx.match === "string" ? ctx.match.trim() : "";

    if (!args) {
      await ctx.reply(
        "Please provide the target ID to delete. Example:\n" +
        "```\n/delTarget 1\n```",
        { "parse_mode": "Markdown" },
      );

      return;
    }

    const targetId = Number(args);

    if (isNaN(targetId)) {
      await ctx.reply("Please provide a valid numeric ID.");

      return;
    }

    const target = targetRepo.getById(targetId);

    if (!target) {
      await ctx.reply(`\u{274C} Target with ID ${targetId} not found.`);

      return;
    }

    if (pendingDeletions.has(targetId)) {
      pendingDeletions.delete(targetId);

      targetRepo.delete(targetId);
      removeTargetFromScheduler(targetId);

      await ctx.reply(`\u{2705} Target *${target.name}* (ID: ${targetId}) has been deleted.`, { "parse_mode": "Markdown" });

      return;
    }

    pendingDeletions.add(targetId);

    await ctx.reply(
      `\u{26A0}\u{FE0F} Are you sure you want to delete *${target.name}* (ID: ${targetId})?\n\n` +
      `Send /delTarget ${targetId} again to confirm.`,
      { "parse_mode": "Markdown" },
    );
  }));

  bot.on("message:text", async (ctx) => {
    const text = ctx.msg?.text ?? "";

    // Skip command-like messages.
    if (text.startsWith("/")) {
      return;
    }

    const sessionKey = getSessionKey(ctx);

    if (!sessionKey || !pendingTargets.has(sessionKey)) {
      return;
    }

    if (!(await ensureCommandAccess(ctx))) {
      pendingTargets.delete(sessionKey);

      return;
    }

    await handleAddTargetMessage(ctx);
  });

  return bot;
}

export function initBot(token?: string, adminUserIdStr?: string, notificationChatIdStr?: string): Bot | null {
  if (!token) {
    log.warn("BOT | TELEGRAM_BOT_TOKEN is not set; bot was disabled");

    return null;
  }

  adminUserId = parseId(adminUserIdStr, "ADMIN_USER_ID");
  notificationChatId = parseId(notificationChatIdStr, "NOTIFICATION_CHAT_ID");

  if (adminUserId === null) {
    log.warn("BOT | ADMIN_USER_ID is not set; private bot commands are disabled");
  }

  if (notificationChatId === null) {
    log.warn("BOT | NOTIFICATION_CHAT_ID is not set; group notifications are disabled");
  }

  if (getNotificationRecipientIds().length === 0) {
    log.warn("BOT | No notification recipients configured; alerts will be skipped");
  }

  botInstance = createBot(token);
  log.info(
    `BOT | Initialized with admin user ${adminUserId ?? "none"} and notification chat ${notificationChatId ?? "none"}`,
  );

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
  if (!botInstance) {
    return;
  }

  const message = "\u{1F6A8} **ALERT**\n\n" +
    `*${target.name}* (${target.type}) is **DOWN**\n` +
    `URL: \`${target.url}${target.port ? `:${target.port}` : ""}\`\n` +
    `Error: \`${error}\``;

  await sendToRecipients(message, { "parse_mode": "Markdown" });
}

export async function notifyInvestigation(target: Target, report: string): Promise<void> {
  if (!botInstance) {
    return;
  }

  const compactReport = report.length > 3_500
    ? `${report.slice(0, 3_500)}\n\n(Report truncated)`
    : report;

  const message = "\u{1F916} Investigation report\n\n" +
    `Target: ${target.name}\n\n` +
    compactReport;

  await sendToRecipients(message);
}

export async function notifyUp(target: Target): Promise<void> {
  if (!botInstance) {
    return;
  }

  const message = "\u{2705} **RECOVERED**\n\n" +
    `*${target.name}* (${target.type}) is back **UP**`;

  await sendToRecipients(message, { "parse_mode": "Markdown" });
}
