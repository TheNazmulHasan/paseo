// model-menu.ts — `agents.providers.<id>.modelMenu` (Nazmul's model-menu mod).
// A provider can list dozens of models (Claude through a CLIProxyAPI router lists every slug the
// router serves). `first` puts the ones the user actually picks at the top, in pattern order;
// `hide` takes clutter out of the picker without removing it, so an old chat on a hidden model
// still resolves its label.
import type { AgentModelDefinition } from "./agent-sdk-types.js";

export interface ModelMenuConfig {
  first?: string[];
  hide?: string[];
}

function toMatcher(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function applyModelMenu(
  models: AgentModelDefinition[],
  menu: ModelMenuConfig | undefined,
): AgentModelDefinition[] {
  if (!menu || (!menu.first?.length && !menu.hide?.length)) return models;
  const first = (menu.first ?? []).map(toMatcher);
  const hide = (menu.hide ?? []).map(toMatcher);
  const rank = (model: AgentModelDefinition) => {
    const index = first.findIndex((matcher) => matcher.test(model.id));
    return index === -1 ? first.length : index;
  };
  const ordered = models
    .map((model, position) => ({ model, position, rank: rank(model) }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position);
  // Copies, never mutation: the catalog's model objects can be shared with a cached snapshot.
  const result: AgentModelDefinition[] = [];
  for (const { model, rank: modelRank } of ordered) {
    const hidden = modelRank === first.length && hide.some((matcher) => matcher.test(model.id));
    result.push(hidden ? Object.assign({}, model, { isSelectable: false }) : model);
  }
  return result;
}
