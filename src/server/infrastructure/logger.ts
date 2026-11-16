import { randomUUID } from "node:crypto";

type Level = "warn" | "error";

/**
 * One JSON line per event: level, source, code and an `eventId` unique to the line. Never the message,
 * details or hint of Postgres or GoTrue, which can carry a whole row or an address. Request-wide
 * correlation is not provided here (observability task).
 */
function write(level: Level, source: string, code: string | undefined): void {
  console[level](JSON.stringify({ level, source, code: code ?? "unknown", eventId: randomUUID() }));
}

export function logInfrastructureError(source: string, code: string | undefined): void {
  write("error", source, code);
}

export function logWarning(source: string, code: string): void {
  write("warn", source, code);
}
