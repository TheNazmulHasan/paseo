import { promises as fs } from "node:fs";
import path from "node:path";

import {
  EMPTY_HOME_STATE,
  HOME_KEEP_DAYS,
  HomeStateSchema,
  normalizeHomeLayout,
  type HomeLayout,
  type HomeState,
} from "@getpaseo/protocol/home";

import { writeFileAtomic } from "../atomic-file.js";

/**
 * Nazmul mod (home-map): what Home remembers between runs, in `<paseoHome>/home/state.json`:
 * what he put off with Later, what Sweep "Keep" hid, and the layout Chief wrote. The transforms
 * are pure; the store only reads and writes the file.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Drops snoozes and keeps whose time has passed, so the file never grows without bound. */
export function pruneHomeState(state: HomeState, now: number): HomeState {
  const live = (record: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(record).filter(([, until]) => {
        const time = Date.parse(until);
        return !Number.isNaN(time) && time > now;
      }),
    );
  return { ...state, snoozed: live(state.snoozed), kept: live(state.kept) };
}

/** `until` null (or in the past) brings the session back to the queue now. */
export function applySnooze(
  state: HomeState,
  agentId: string,
  until: string | null,
  now: number,
): HomeState {
  const { [agentId]: _removed, ...rest } = state.snoozed;
  const time = until === null ? Number.NaN : Date.parse(until);
  if (until !== null && Number.isNaN(time)) {
    throw new Error(`"${until}" is not a time. Use an ISO date and time.`);
  }
  const snoozed = until !== null && time > now ? { ...rest, [agentId]: new Date(time).toISOString() } : rest;
  return pruneHomeState({ ...state, snoozed }, now);
}

/** Sweep "Keep" hides a session from Check on these for HOME_KEEP_DAYS; `keep: false` releases it. */
export function applyKeep(state: HomeState, agentId: string, keep: boolean, now: number): HomeState {
  const { [agentId]: _removed, ...rest } = state.kept;
  const kept = keep
    ? { ...rest, [agentId]: new Date(now + HOME_KEEP_DAYS * MS_PER_DAY).toISOString() }
    : rest;
  return pruneHomeState({ ...state, kept }, now);
}

export function applyLayout(state: HomeState, layout: HomeLayout | null): HomeState {
  if (layout === null) return { ...state, chiefLayout: null };
  const normalized = normalizeHomeLayout(layout);
  return { ...state, chiefLayout: normalized.groups.length > 0 ? normalized : null };
}

export class HomeStateStore {
  private state: HomeState = { ...EMPTY_HOME_STATE, snoozed: {}, kept: {} };
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** A missing or damaged file is an empty state, never an error. */
  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8")) as unknown;
      const parsed = HomeStateSchema.safeParse(raw);
      if (parsed.success) this.state = pruneHomeState(parsed.data, this.now());
    } catch {
      // first run, or unreadable: start empty
    }
  }

  get(): HomeState {
    return pruneHomeState(this.state, this.now());
  }

  snooze(agentId: string, until: string | null): Promise<HomeState> {
    return this.mutate((state, now) => applySnooze(state, agentId, until, now));
  }

  keep(agentId: string, keep: boolean): Promise<HomeState> {
    return this.mutate((state, now) => applyKeep(state, agentId, keep, now));
  }

  setLayout(layout: HomeLayout | null): Promise<HomeState> {
    return this.mutate((state) => applyLayout(state, layout));
  }

  private async mutate(change: (state: HomeState, now: number) => HomeState): Promise<HomeState> {
    this.state = change(this.state, this.now());
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writing = this.writing
      .catch(() => undefined)
      .then(() => writeFileAtomic(this.filePath, snapshot));
    await this.writing;
    return this.get();
  }

  static pathFor(paseoHome: string): string {
    return path.join(paseoHome, "home", "state.json");
  }
}
