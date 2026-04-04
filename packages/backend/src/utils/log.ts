export default {
  "info" : (...input: Array<unknown>) => console.log("INFO  |", ...input),
  "debug": (...input: Array<unknown>) => console.log("DEBUG |", ...input),
  "warn" : (...input: Array<unknown>) => console.log("WARN  |", ...input),
  "error": (...input: Array<unknown>) => console.log("ERROR |", ...input),
};