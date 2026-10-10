// User-facing copy and formatting for the CLIProxyAPI last-request section in
// the context-meter tooltip, centralized the way gateway-quota/copy.ts is.
export const gatewayStatsCopy = {
  title: "CLIProxyAPI latest request",
  firstToken: "First token",
  generating: "Generating",
  total: "Total",
  throughput: "Throughput",
  ran: "Ran",
} as const;

/** Seconds, one decimal below 10s and whole above it. Feeds every timing row. */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0s";
  const seconds = durationMs / 1000;
  return seconds >= 10 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`;
}

export function formatThroughput(tps: number): string {
  if (!Number.isFinite(tps) || tps <= 0) return "0 tok/s";
  return `${tps >= 100 ? tps.toFixed(0) : tps.toFixed(1)} tok/s`;
}

/**
 * "just now", "5m ago", "2h ago", "3d ago". Moved here from the retired
 * `provider-usage/format` (upstream 0.11 dropped it); this section is its only user.
 */
export function formatAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs < 60_000) return "just now";
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  return `${diffMinutes}m ago`;
}
