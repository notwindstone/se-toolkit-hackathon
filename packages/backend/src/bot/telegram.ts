import { Bot, type Context } from "grammy";

import log from "@/utils/log";
import { targetRepo, type Target, type CreateTargetDTO } from "@/db/targets";
import { healthCheckRepo } from "@/db/healthChecks";
import { addTargetToScheduler, removeTargetFromScheduler } from "@/checker/scheduler";

let botInstance: Bot | null = null;
let adminChatId: number | null = null;

type AddTargetStep = "name" | "type" | "url" | "port" | "interval";

interface PendingTarget extends Partial<CreateTargetDTO> {
  "step": AddTargetStep;
}

// Store pending target data for multi-step add command
const pendingTargets = new Map<number, PendingTarget>();
// Store target IDs pending deletion for confirmation
const pendingDeletions = new Set<number>();

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

function handleAddTargetMessage(ctx: Context): void {
  const userId = ctx.from?.id;

  if (!userId) {
    return;
  }

  const pending = pendingTargets.get(userId);

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
      pendingTargets.set(userId, pending);

      ctx.reply(
        "Now send the **type** (`http` or `postgres`):",
        { "parse_mode": "Markdown" },
      );

      break;
    }
    case "type": {
      if (text !== "http" && text !== "postgres") {
        ctx.reply("Please send `http` or `postgres`.", { "parse_mode": "Markdown" });

        break;
      }

      pending.type = text;
      pending.step = "url";
      pendingTargets.set(userId, pending);

      ctx.reply(
        "Now send the **URL** (e.g., `https://example.com` or `localhost` for Postgres):",
        { "parse_mode": "Markdown" },
      );

      break;
    }
    case "url": {
      pending.url = text;
      pending.step = "port";
      pendingTargets.set(userId, pending);

      ctx.reply(
        "Now send the **port** (or `0` if not needed):",
        { "parse_mode": "Markdown" },
      );

      break;
    }
    case "port": {
      const port = Number(text);

      if (text !== "0" && isNaN(port)) {
        ctx.reply("Please send a valid number.");

        break;
      }

      pending.port = port === 0 ? undefined : port;
      pending.step = "interval";
      pendingTargets.set(userId, pending);

      ctx.reply(
        "Finally, send the **check interval in seconds** (e.g., `60`):",
        { "parse_mode": "Markdown" },
      );

      break;
    }
    case "interval": {
      const interval = Number(text);

      if (isNaN(interval) || interval < 1) {
        ctx.reply("Please send a valid number greater than 0.");

        break;
      }

      pending.check_interval_seconds = interval;
      pendingTargets.delete(userId);

      try {
        const target = targetRepo.create(pending as CreateTargetDTO);

        addTargetToScheduler(target);

        ctx.reply(
          (
            "✅ Target added successfully!\n" +
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
        ctx.reply("❌ Failed to add target. Check logs for details.");
      }

      break;
    }
  }
}

function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;

    if (userId === undefined) {
      await ctx.reply("Could not identify user.");

      return;
    }

    await ctx.reply(
      "Welcome to Yesod - a VDS monitoring assistant.\n" +
      "\n" +
      "Available commands:\n" +
      "/status - Show all monitored targets\n" +
      "/uptime - Show uptime statistics\n" +
      "/addTarget - Add a new target to monitor\n" +
      "/delTarget - Delete a target by ID\n" +
      "\n" +
      "I will also send a message automatically when something goes down.",
      { "parse_mode": "Markdown" },
    );
  });

  bot.command("status", async (ctx) => {
    const targets = targetRepo.getAllIncludingDisabled();

    if (targets.length === 0) {
      await ctx.reply("No targets configured yet. You can add them here (/addTarget), via Dashboard, or through API.");

      return;
    }

    const lines = targets.map((t: Target) => {
      const lastCheck = healthCheckRepo.getRecentByTarget(t.id, 1)[0] ?? null;
      const uptime = healthCheckRepo.getUptimePercent(t.id);
      const enabled = t.enabled ? "" : " _(disabled)_";
      const status = lastCheck?.status ?? null;
      const error = lastCheck?.error ? `\nError      | ${lastCheck.error}` : "";

      const lastCheckTime = new Date(lastCheck?.checked_at ?? "Never");
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

  bot.command("addTarget", async (ctx) => {
    const userId = ctx.from?.id;

    if (userId === undefined) {
      await ctx.reply("Could not identify user.");

      return;
    }

    pendingTargets.set(userId, { "step": "name" });

    await ctx.reply(
      "Let's add a new target. Please send the **name** of the target:",
      { "parse_mode": "Markdown" },
    );
  });

  bot.command("delTarget", async (ctx) => {
    const userId = ctx.from?.id;

    if (userId === undefined) {
      await ctx.reply("Could not identify user.");

      return;
    }

    const args = ctx.match?.trim();

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
      await ctx.reply(`❌ Target with ID ${targetId} not found.`);

      return;
    }

    if (pendingDeletions.has(targetId)) {
      pendingDeletions.delete(targetId);

      targetRepo.delete(targetId);
      removeTargetFromScheduler(targetId);

      await ctx.reply(`✅ Target *${target.name}* (ID: ${targetId}) has been deleted.`, { "parse_mode": "Markdown" });

      return;
    }

    pendingDeletions.add(targetId);

    await ctx.reply(
      `⚠️ Are you sure you want to delete *${target.name}* (ID: ${targetId})?\n\n` +
      `Send /delTarget ${targetId} again to confirm.`,
      { "parse_mode": "Markdown" },
    );
  });

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id;
    const text = ctx.msg?.text ?? "";

    // Skip command-like messages
    if (text.startsWith("/")) {
      return;
    }

    if (userId && pendingTargets.has(userId)) {
      handleAddTargetMessage(ctx);
    }
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
