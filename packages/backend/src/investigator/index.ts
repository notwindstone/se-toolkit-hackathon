import { spawn } from "child_process";

import type { CheckResult } from "@/checker/checkers";
import type { Target } from "@/db/targets";
import log from "@/utils/log";

interface CommandResult {
  "command": string;
  "stdout": string;
  "stderr": string;
  "exitCode": number | null;
  "timedOut": boolean;
}

interface InvestigatorConfig {
  "enabled": boolean;
  "sshUser": string;
  "sshHost": string;
  "sshPort": number;
  "sshKeyPath": string | null;
  "commandTimeoutMs": number;
  "cooldownMs": number;
  "qwenApiKey": string | null;
  "qwenApiBaseUrl": string;
  "qwenModel": string;
}

const runningTargets = new Set<number>();
const lastInvestigationAt = new Map<number, number>();

function envBool(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();

  if (!value) {
    return defaultValue;
  }

  return value === "1" || value === "true" || value === "yes";
}

function envNumber(name: string, defaultValue: number): number {
  const value = Number(process.env[name] ?? defaultValue);

  if (isNaN(value)) {
    return defaultValue;
  }

  return value;
}

function getConfig(target: Target): InvestigatorConfig {
  const fallbackHost = target.url
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .trim();

  return {
    "enabled"         : envBool("INVESTIGATOR_ENABLED", true),
    "sshUser"         : process.env.INVESTIGATOR_SSH_USER?.trim() ?? "",
    "sshHost"         : process.env.INVESTIGATOR_SSH_HOST?.trim() || fallbackHost,
    "sshPort"         : envNumber("INVESTIGATOR_SSH_PORT", 22),
    "sshKeyPath"      : process.env.INVESTIGATOR_SSH_KEY_PATH?.trim() || null,
    "commandTimeoutMs": envNumber("INVESTIGATOR_COMMAND_TIMEOUT_MS", 20_000),
    "cooldownMs"      : envNumber("INVESTIGATOR_COOLDOWN_SECONDS", 900) * 1000,
    "qwenApiKey"      : process.env.QWEN_API_KEY?.trim() || null,
    "qwenApiBaseUrl"  : process.env.QWEN_API_BASE_URL?.trim() || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "qwenModel"       : process.env.QWEN_MODEL?.trim() || "qwen-plus",
  };
}

function runProcess(command: string, args: Array<string>, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { "stdio": ["ignore", "pipe", "pipe"] });

    const stdoutChunks: Array<Buffer> = [];
    const stderrChunks: Array<Buffer> = [];
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");

      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);

      resolve({
        "command": `${command} ${args.join(" ")}`,
        "stdout" : Buffer.concat(stdoutChunks).toString("utf-8").trim(),
        "stderr" : Buffer.concat(stderrChunks).toString("utf-8").trim(),
        "exitCode": code,
        "timedOut": timedOut,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);

      resolve({
        "command": `${command} ${args.join(" ")}`,
        "stdout" : "",
        "stderr" : err.message,
        "exitCode": null,
        "timedOut": false,
      });
    });
  });
}

function sshCommandArgs(config: InvestigatorConfig, remoteCommand: string): Array<string> {
  const args = [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-p", String(config.sshPort),
  ];

  if (config.sshKeyPath) {
    args.push("-i", config.sshKeyPath);
  }

  args.push(`${config.sshUser}@${config.sshHost}`);
  args.push(remoteCommand);

  return args;
}

function getDiagnosticCommands(target: Target): Array<string> {
  const commands = [
    "hostname",
    "uptime",
    "uname -a",
    "systemctl --failed --no-pager || true",
    "df -h",
    "free -m",
    "ss -tulpen | head -n 30 || true",
  ];

  if (target.type === "http") {
    const probeUrl = /^https?:\/\//.test(target.url) ? target.url : `http://${target.url}`;

    commands.push(`curl -I -m 10 -sS ${JSON.stringify(probeUrl)} || true`);
  }

  if (target.type === "postgres") {
    const host = target.url;
    const port = target.port ?? 5432;

    commands.push(`pg_isready -h ${JSON.stringify(host)} -p ${port} || true`);
  }

  if (/^[a-zA-Z0-9_.@-]+$/.test(target.name)) {
    commands.push(`systemctl status ${target.name} --no-pager -n 60 || true`);
    commands.push(`journalctl -u ${target.name} -n 60 --no-pager || true`);
  }

  return commands;
}

function formatDiagnostics(results: Array<CommandResult>): string {
  return results
    .map((result) => {
      const status = result.timedOut
        ? "TIMED OUT"
        : (result.exitCode === 0 ? "OK" : `EXIT ${result.exitCode ?? "ERR"}`);

      return [
        `COMMAND: ${result.command}`,
        `STATUS: ${status}`,
        `STDOUT:\n${result.stdout || "(empty)"}`,
        `STDERR:\n${result.stderr || "(empty)"}`,
      ].join("\n");
    })
    .join("\n\n-----\n\n");
}

async function summarizeWithQwen(
  config: InvestigatorConfig,
  target: Target,
  checkResult: CheckResult,
  diagnostics: string,
): Promise<string> {
  if (!config.qwenApiKey) {
    return "QWEN_API_KEY is not configured, so only raw SSH diagnostics were collected.";
  }

  const payload = {
    "model"   : config.qwenModel,
    "messages": [
      {
        "role"   : "system",
        "content": "You are a senior SRE. Summarize likely root cause and provide short actionable remediation steps.",
      },
      {
        "role"   : "user",
        "content": [
          `Target Name: ${target.name}`,
          `Target Type: ${target.type}`,
          `Target URL: ${target.url}`,
          `Observed Error: ${checkResult.error ?? "n/a"}`,
          "",
          "Remote diagnostics:",
          diagnostics.slice(0, 16_000),
          "",
          "Reply with exactly this structure:",
          "1) Root cause hypothesis",
          "2) Evidence",
          "3) Next fix steps (max 4 bullets)",
        ].join("\n"),
      },
    ],
    "temperature": 0.2,
    "max_tokens" : 400,
  };

  const response = await fetch(`${config.qwenApiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    "method" : "POST",
    "headers": {
      "Authorization": `Bearer ${config.qwenApiKey}`,
      "Content-Type" : "application/json",
    },
    "body": JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(`Qwen API failed: HTTP ${response.status} ${text}`);
  }

  const json = await response.json() as {
    "choices"?: Array<{ "message"?: { "content"?: string } }>;
  };

  return json.choices?.[0]?.message?.content?.trim() ?? "Qwen returned an empty response.";
}

function formatReport(summary: string, diagnostics: string): string {
  return [
    "AI investigation summary:",
    summary.trim(),
    "",
    "Raw diagnostics:",
    diagnostics.slice(0, 3_500),
  ].join("\n");
}

export async function investigateFailure(target: Target, checkResult: CheckResult): Promise<string | null> {
  const config = getConfig(target);

  if (!config.enabled) {
    return null;
  }

  if (!config.sshUser || !config.sshHost) {
    log.warn(`INVESTIGATOR | Missing SSH configuration for target ${target.name}`);

    return null;
  }

  if (runningTargets.has(target.id)) {
    log.debug(`INVESTIGATOR | Skipping ${target.name}; investigation already running`);

    return null;
  }

  const now = Date.now();
  const lastRun = lastInvestigationAt.get(target.id) ?? 0;

  if (now - lastRun < config.cooldownMs) {
    log.debug(`INVESTIGATOR | Skipping ${target.name}; cooldown active`);

    return null;
  }

  runningTargets.add(target.id);

  try {
    const commandResults: Array<CommandResult> = [];
    const remoteCommands = getDiagnosticCommands(target);

    for (const remoteCommand of remoteCommands) {
      const result = await runProcess(
        "ssh",
        sshCommandArgs(config, remoteCommand),
        config.commandTimeoutMs,
      );

      commandResults.push(result);
    }

    const diagnostics = formatDiagnostics(commandResults);

    let summary: string;

    try {
      summary = await summarizeWithQwen(config, target, checkResult, diagnostics);
    } catch (err) {
      summary = `AI summarization failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    const report = formatReport(summary, diagnostics);

    lastInvestigationAt.set(target.id, now);
    log.info(`INVESTIGATOR | Completed investigation for ${target.name}`);

    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    log.error(`INVESTIGATOR | Failed to investigate ${target.name}: ${message}`);
    lastInvestigationAt.set(target.id, now);

    return `Investigation failed: ${message}`;
  } finally {
    runningTargets.delete(target.id);
  }
}
