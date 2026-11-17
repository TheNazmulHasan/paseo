import { describe, expect, test } from "vitest";

import type { AgentModelDefinition } from "./agent-sdk-types.js";
import { applyModelMenu } from "./model-menu.js";

const model = (id: string): AgentModelDefinition => ({ provider: "claude", id, label: id });
const ids = (models: AgentModelDefinition[]) =>
  models.filter((entry) => entry.isSelectable !== false).map((entry) => entry.id);

describe("applyModelMenu", () => {
  const catalog = [
    "claude-opus-4-7",
    "claude-opus-5-5[1m]",
    "gpt-6-sol",
    "shajeeb/claude-opus-5-5[1m]",
    "pool/claude-haiku-5-5",
    "claude-haiku-5-5",
  ].map(model);

  test("leads with `first` in pattern order and keeps the rest in catalog order", () => {
    const result = applyModelMenu(catalog, {
      first: ["claude-opus-5-5[1m]", "*/claude-*", "claude-haiku-5-5"],
    });
    expect(ids(result)).toEqual([
      "claude-opus-5-5[1m]",
      "shajeeb/claude-opus-5-5[1m]",
      "pool/claude-haiku-5-5",
      "claude-haiku-5-5",
      "claude-opus-4-7",
      "gpt-6-sol",
    ]);
  });

  test("hides matches from the picker but keeps them in the catalog", () => {
    const result = applyModelMenu(catalog, {
      first: ["claude-haiku-5-5"],
      hide: ["gpt-*", "claude-haiku-*"],
    });
    expect(ids(result)).toEqual([
      "claude-haiku-5-5",
      "claude-opus-4-7",
      "claude-opus-5-5[1m]",
      "shajeeb/claude-opus-5-5[1m]",
      "pool/claude-haiku-5-5",
    ]);
    expect(result).toHaveLength(catalog.length);
  });

  test("no menu leaves the catalog untouched", () => {
    expect(applyModelMenu(catalog, undefined)).toBe(catalog);
  });
});
