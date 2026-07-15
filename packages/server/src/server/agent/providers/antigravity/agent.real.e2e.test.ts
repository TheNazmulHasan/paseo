/**
 * Real end-to-end smoke test for the Antigravity (agy) provider.
 *
 * Run with:
 *   npx vitest run src/server/agent/providers/antigravity/agent.real.e2e.test.ts
 *
 * Requires `agy` installed and authenticated (verify with `agy models`).
 * Skips itself cleanly when `agy` is not available.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import pino from "pino";

import { AntigravityAgentClient } from "./agent.js";

const TIMEOUT_MS = 120_000;

function makeClient() {
  return new AntigravityAgentClient({ logger: pino({ level: "silent" }) });
}

test(
  "antigravity: availability, catalog, and a real turn",
  async () => {
    const client = makeClient();

    const available = await client.isAvailable();
    if (!available) {
      // agy not installed/authenticated in this environment — nothing to test.
      return;
    }

    const catalog = await client.fetchCatalog({ scope: "global", force: true });
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.modes.length).toBe(2);

    const cwd = mkdtempSync(join(tmpdir(), "paseo-agy-e2e-"));
    try {
      const session = await client.createSession({
        provider: "antigravity",
        cwd,
        modeId: "default",
      });
      const result = await session.run("Reply with exactly: PASEO_TEST_OK");
      expect(result.finalText).toContain("PASEO_TEST_OK");
      await session.close();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
  TIMEOUT_MS,
);
