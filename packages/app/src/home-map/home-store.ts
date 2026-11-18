import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { DEFAULT_QUEUE_SORT, QUEUE_SORTS, type QueueSort } from "./view-model";

/**
 * Home v2 keeps almost nothing on the device: the daemons own the brief and the state. What stays
 * here is the count of sessions closed from Home today, the stand-in for "closed today" when no
 * daemon has answered with its own count (an older daemon, or still connecting).
 *
 * `queueSort` is how Your queue is ordered (Priority, Waiting longest, Folder, Recent); it is the
 * one preference Home remembers on the device. Absent in older stored states, so it is optional
 * in the schema and filled with the default.
 *
 * Version 2 replaced the v1 map's fold state and Show quiet switch (both removed); an old stored
 * shape fails the schema, is dropped by the storage wrapper and starts from the defaults.
 */
const HOME_STORE_VERSION = 2;

export interface HomeClosedTodayLocal {
  /** Local day the count belongs to, "YYYY-MM-DD". */
  day: string;
  count: number;
}

interface HomePersistedState {
  closedTodayLocal: HomeClosedTodayLocal;
  queueSort: QueueSort;
}

interface HomeStoreState extends HomePersistedState {
  /** Adds closes made from Home (negative: an undo); a new day starts the count again. */
  recordClosed: (count: number, day: string) => void;
  setQueueSort: (sort: QueueSort) => void;
}

const HomePersistedStateSchema = z.strictObject({
  closedTodayLocal: z.strictObject({ day: z.string(), count: z.number().int().nonnegative() }),
  queueSort: z.enum(QUEUE_SORTS).optional(),
});

function emptyHomeState(): HomePersistedState {
  return { closedTodayLocal: { day: "", count: 0 }, queueSort: DEFAULT_QUEUE_SORT };
}

/** Junk or an older shape never crashes Home: it starts from the defaults. */
export function migrateHomeState(persistedState: unknown): HomePersistedState {
  const result = HomePersistedStateSchema.safeParse(persistedState);
  if (!result.success) return emptyHomeState();
  return {
    closedTodayLocal: result.data.closedTodayLocal,
    queueSort: result.data.queueSort ?? DEFAULT_QUEUE_SORT,
  };
}

/** The next local counter after `count` more closes on `day`. */
export function addClosedToday(
  current: HomeClosedTodayLocal,
  count: number,
  day: string,
): HomeClosedTodayLocal {
  // `count` is negative when a close is undone; the counter never goes below 0.
  const base = current.day === day ? current.count : 0;
  return { day, count: Math.max(0, base + count) };
}

export const useHomeStore = create<HomeStoreState>()(
  persist(
    (set) => ({
      ...emptyHomeState(),
      recordClosed: (count, day) =>
        set((state) => ({ closedTodayLocal: addClosedToday(state.closedTodayLocal, count, day) })),
      setQueueSort: (queueSort) => set({ queueSort }),
    }),
    {
      name: "paseo-home-map",
      storage: createValidatedPersistStorage(AsyncStorage, HomePersistedStateSchema),
      version: HOME_STORE_VERSION,
      migrate: migrateHomeState,
      partialize: (state): HomePersistedState => ({
        closedTodayLocal: state.closedTodayLocal,
        queueSort: state.queueSort,
      }),
    },
  ),
);
