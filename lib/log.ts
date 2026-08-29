/**
 * Logging. Deliberately plain: these processes run under systemd, so stdout is
 * already collected, timestamped and rotated by journald.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold: number =
  LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;

function emit(level: Level, message: string, extra?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const stamp = new Date().toISOString();
  const line = `${stamp} ${level.toUpperCase().padEnd(5)} ${message}`;
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  if (extra instanceof Error) {
    stream(line, "-", extra.message, extra.stack ? `\n${extra.stack}` : "");
  } else if (extra !== undefined) {
    stream(line, "-", typeof extra === "string" ? extra : JSON.stringify(extra));
  } else {
    stream(line);
  }
}

export const log = {
  debug: (m: string, e?: unknown) => emit("debug", m, e),
  info: (m: string, e?: unknown) => emit("info", m, e),
  warn: (m: string, e?: unknown) => emit("warn", m, e),
  error: (m: string, e?: unknown) => emit("error", m, e),
};
