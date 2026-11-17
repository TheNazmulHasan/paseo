import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError } from "../../output/index.js";

export interface ChiefCommandOptions {
  host?: string;
  daemonTarget: import("../../utils/daemon-target.js").DaemonTarget;
}

/** Connects, runs, closes. Any failure that is not already a CommandError gets `failureCode`. */
export async function withChiefClient<T>(
  options: ChiefCommandOptions,
  failureCode: string,
  run: (client: DaemonClient) => Promise<T>,
): Promise<T> {
  const host = getDaemonHost({ target: options.daemonTarget });
  const client = await connectToDaemon({ target: options.daemonTarget }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    } satisfies CommandError;
  });
  try {
    return await run(client);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: failureCode, message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function invalidArguments(message: string): CommandError {
  return { code: "INVALID_ARGUMENTS", message };
}

/** `--limit 20` as a positive whole number, or undefined when not given. */
export function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw invalidArguments(`--limit must be a positive whole number, got: ${value}`);
  }
  return parsed;
}

/** One line of text for a table cell. */
export function oneLine(text: string | null | undefined, max: number): string {
  const folded = (text ?? "").replace(/\s+/g, " ").trim();
  return folded.length > max ? `${folded.slice(0, max - 1)}…` : folded;
}

export const SESSION_STATE_NAMES = ["needs_you", "working", "your_move", "parked"] as const;
