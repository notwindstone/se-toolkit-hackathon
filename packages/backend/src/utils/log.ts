export function logInfo(...input: Array<unknown>): void {
  console.log("INFO  |", ...input);
}

export function logDebug(...input: Array<unknown>): void {
  console.log("DEBUG |", ...input);
}

export function logWarn(...input: Array<unknown>): void {
  console.log("WARN  |", ...input);
}

export function logError(...input: Array<unknown>): void {
  console.log("ERROR |", ...input);
}

export default {
  "info" : logInfo,
  "debug": logDebug,
  "warn" : logWarn,
  "error": logError,
} as const;
