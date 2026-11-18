// Home v2 (fork mod, home-map): after a close (or any action whose effect the daemon only sees
// later), Home asks every host for a fresh snapshot a moment later, so "closed today" and Chief's
// changes stay current. Each host's sync registers its fetch; the debounce is shared.

const fetchers = new Map<string, () => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function registerHomeFetcher(serverId: string, fetchNow: () => void): () => void {
  fetchers.set(serverId, fetchNow);
  return () => {
    if (fetchers.get(serverId) === fetchNow) fetchers.delete(serverId);
  };
}

/** Fetches every registered host once, `delayMs` after the last request. */
export function requestHomeRefetch(delayMs = 1000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    for (const fetchNow of fetchers.values()) fetchNow();
  }, delayMs);
}

/** Test seam. */
export function resetHomeRefetchForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  fetchers.clear();
}
