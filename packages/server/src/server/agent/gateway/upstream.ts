// gateway/upstream.ts — follow a local Gateway's API-key account through to the
// CLIProxyAPI it forwards to (`agents.cliproxyapi.upstream`).
//
// A local router can hold another CLIProxyAPI as one API-key credential (Nazmul's
// switchboard: this Mac's logins first, Riajul's pool last). The local router then
// names that whole pool `config:claude[<hash>]`, which tells the user nothing. The
// upstream records the same session id, so its `/v1/session-route` names the real
// account, and its `/v1/quota` lists the real accounts behind the pool.
// Read-only; every failure keeps the local answer.
import { z } from "zod";

export const GatewayUpstreamConfigSchema = z
  .object({
    baseUrl: z.string(),
    apiKey: z.string(),
  })
  .strict();

export type GatewayUpstreamConfig = z.infer<typeof GatewayUpstreamConfigSchema>;

export interface ResolvedGatewayUpstream {
  baseUrl: string;
  apiKey: string;
}

let configuredUpstream: ResolvedGatewayUpstream | null = null;

/** Set once at daemon start, like the Gateway itself. */
export function setGatewayUpstream(config: GatewayUpstreamConfig | null | undefined): void {
  const baseUrl = config?.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  const apiKey = config?.apiKey.trim();
  configuredUpstream = baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

export function getGatewayUpstream(): ResolvedGatewayUpstream | null {
  return configuredUpstream;
}

/** Local route ids carry the router's pin prefix (`pool/claude-opus-5-5`); the upstream knows the bare id. */
export function upstreamModelSlug(model: string): string {
  const slash = model.lastIndexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

/** The upstream twin of a local Gateway URL: same path and query, upstream origin. */
export function upstreamUrl(localUrl: string, upstream: ResolvedGatewayUpstream): string | null {
  try {
    const local = new URL(localUrl);
    const target = new URL(`${upstream.baseUrl}${local.pathname}`);
    target.search = local.search;
    const model = target.searchParams.get("model");
    if (model) target.searchParams.set("model", upstreamModelSlug(model));
    return target.toString();
  } catch {
    return null;
  }
}
