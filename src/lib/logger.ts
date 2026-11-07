// CLAUDE-OWNED (M9). JSON-lines call logs, SPEC §11. Shaped so a log tool could ingest them; nothing is wired to one.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pino from "pino";
import type { CallEvent } from "../journey/runner.js";

// Synchronous writes: a short CLI or seed run must not exit with log lines still buffered.
export function fileCallLog(path: string): (event: CallEvent) => void {
  mkdirSync(dirname(path), { recursive: true });
  const logger = pino({ base: null, timestamp: pino.stdTimeFunctions.isoTime }, pino.destination({ dest: path, sync: true }));
  return (event) => logger.info(event);
}
