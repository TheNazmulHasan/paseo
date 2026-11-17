import { afterEach, describe, expect, test, vi } from "vitest";

import { fetchGatewayQuota } from "./quota.js";
import { fetchGatewaySessionRoute } from "./session-route.js";
import { setGatewayUpstream, upstreamModelSlug } from "./upstream.js";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const LOCAL = "http://127.0.0.1:8318";
const UPSTREAM = "https://pool.example";

const poolAccount = {
  provider: "claude",
  provider_name: "Claude",
  name: "config:claude[0123456789ab]",
  type: "api",
  in_cooldown: false,
};
const localOauth = (name: string) => ({
  provider: "claude",
  provider_name: "Claude",
  name,
  type: "oauth",
  plan: "Team",
  in_cooldown: false,
  windows: [{ name: "5h", used_percent: 30 }],
});
const routeRecord = (account: object, switches: object[] = []) => ({
  session: "claude:s1",
  account,
  model: "claude-opus-5-5",
  since: "2026-11-17T02:00:00Z",
  last_seen: "2026-11-17T02:05:00Z",
  switches,
});

/** One fetch for both routers, answering by origin. */
function routers(local: () => Response, upstream: () => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    if (url.startsWith(UPSTREAM)) {
      expect(auth).toBe("Bearer sk-pool");
      return upstream();
    }
    expect(auth).toBe("Bearer sk-local");
    return local();
  });
}

afterEach(() => setGatewayUpstream(null));

describe("upstreamModelSlug", () => {
  test("drops the local router's pin prefix", () => {
    expect(upstreamModelSlug("pool/claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(upstreamModelSlug("claude-opus-5-5")).toBe("claude-opus-5-5");
  });
});

describe("session route through an upstream pool", () => {
  const base = { baseUrl: LOCAL, token: "sk-local", session: "claude:s1" };

  test("names the upstream account behind an API-key credential", async () => {
    setGatewayUpstream({ baseUrl: `${UPSTREAM}/`, apiKey: "sk-pool" });
    const fetchImpl = routers(
      () => json(routeRecord(poolAccount)),
      () =>
        json(
          routeRecord({ ...localOauth("a***1@example.com"), plan: "Max" }, [
            {
              at: "2026-11-17T02:03:00Z",
              from: localOauth("b***2@example.org"),
              to: localOauth("a***1@example.com"),
              reason: "quota",
            },
          ]),
        ),
    );
    const result = await fetchGatewaySessionRoute({ ...base, fetchImpl });
    expect(result.route?.account).toMatchObject({ label: "a***1@example.com", plan: "Max" });
    expect(result.route?.since).toBe("2026-11-17T02:00:00Z");
    expect(result.route?.switches).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("keeps the local answer for an OAuth account, without an upstream, or when it fails", async () => {
    setGatewayUpstream({ baseUrl: UPSTREAM, apiKey: "sk-pool" });
    const oauth = routers(
      () => json(routeRecord(localOauth("c***3@example.org"))),
      () => json({ error: "unused" }, 500),
    );
    expect(
      (await fetchGatewaySessionRoute({ ...base, fetchImpl: oauth })).route?.account.label,
    ).toBe("c***3@example.org");
    expect(oauth).toHaveBeenCalledTimes(1);

    const down = routers(
      () => json(routeRecord(poolAccount)),
      () => json({ error: "no request served for session" }, 404),
    );
    expect(
      (await fetchGatewaySessionRoute({ ...base, fetchImpl: down })).route?.account.label,
    ).toBe("config:claude[0123456789ab]");

    setGatewayUpstream(null);
    const none = routers(
      () => json(routeRecord(poolAccount)),
      () => json([], 500),
    );
    await fetchGatewaySessionRoute({ ...base, fetchImpl: none });
    expect(none).toHaveBeenCalledTimes(1);
  });
});

describe("quota through an upstream pool", () => {
  const base = { baseUrl: LOCAL, token: "sk-local", model: "pool/claude-opus-5-5" };

  test("lists the pool's accounts in its place, each login once", async () => {
    setGatewayUpstream({ baseUrl: UPSTREAM, apiKey: "sk-pool" });
    const fetchImpl = routers(
      () => json([localOauth("c***3@example.org"), { ...poolAccount, windows: [] }]),
      () => json([localOauth("a***1@example.com"), localOauth("c***3@example.org")]),
    );
    const result = await fetchGatewayQuota({ ...base, fetchImpl });
    expect(result.accounts.map((account) => account.name)).toEqual([
      "c***3@example.org",
      "a***1@example.com",
    ]);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(`${UPSTREAM}/v1/quota?model=claude-opus-5-5`);
  });

  test("keeps the pool row when the upstream fails", async () => {
    setGatewayUpstream({ baseUrl: UPSTREAM, apiKey: "sk-pool" });
    const fetchImpl = routers(
      () => json([{ ...poolAccount, windows: [] }]),
      () => json({ error: "bad key" }, 401),
    );
    const result = await fetchGatewayQuota({ ...base, fetchImpl });
    expect(result.accounts.map((account) => account.name)).toEqual(["config:claude[0123456789ab]"]);
  });
});
