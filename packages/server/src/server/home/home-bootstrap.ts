import { readFileSync } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";

import { hasChiefRoleLabel } from "@getpaseo/protocol/chief";
import { deriveSessionState } from "@getpaseo/protocol/session-state";

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { ensureAgentLoaded } from "../agent/agent-loading.js";
import type { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";
import {
  resolveTopicTrailProviders,
  type TopicTrailServiceOptions,
} from "../agent/topic-trail/topic-trail-service.js";
import type { FileBackedFolderRegistry } from "../folders/folder-registry.js";
import type { BriefCard } from "./home-brief.js";
import { HomeService } from "./home-service.js";

/**
 * Nazmul mod (home-map): builds Home's daemon side from what bootstrap already has, so
 * `bootstrap.ts` needs a handful of marked lines instead of the wiring itself. Returns the Home
 * service and the extra options the topic-trail service takes (cards, loading, auto titles).
 */

interface WorkspaceLookup {
  list(): Promise<readonly { workspaceId: string; title?: string | null; displayName: string }[]>;
}

export interface HomeBootstrapDeps {
  paseoHome: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  workspaceRegistry: WorkspaceLookup | null;
  folderRegistry: Pick<FileBackedFolderRegistry, "getSnapshot">;
  logger: Logger;
}

/** `~/.paseo/home-priorities.md`, kept by Chief; absent or unreadable means none. */
export function readHomePriorities(paseoHome: string): string | null {
  try {
    const text = readFileSync(path.join(paseoHome, "home-priorities.md"), "utf8").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function createHome(deps: HomeBootstrapDeps): {
  homeService: HomeService;
  topicTrailOptions: Pick<
    TopicTrailServiceOptions,
    "loadAgent" | "unloadAgent" | "describeSession" | "readPriorities" | "onCardChanged" | "setAutoTitle"
  >;
} {
  const { paseoHome, agentManager, agentStorage, logger } = deps;

  async function lookups() {
    const [workspaces, folders] = await Promise.all([
      deps.workspaceRegistry?.list() ?? Promise.resolve([]),
      deps.folderRegistry.getSnapshot().catch(() => null),
    ]);
    const workspaceNames = new Map(
      workspaces.map((workspace) => [workspace.workspaceId, workspace.title ?? workspace.displayName]),
    );
    const folderNames = new Map((folders?.folders ?? []).map((folder) => [folder.id, folder.name]));
    return {
      workspaceName: (workspaceId: string | undefined) =>
        workspaceId ? (workspaceNames.get(workspaceId) ?? null) : null,
      folderName: (workspaceId: string | undefined) => {
        const folderId = workspaceId ? folders?.membership[workspaceId] : undefined;
        return folderId ? (folderNames.get(folderId) ?? null) : null;
      },
    };
  }

  const homeService = new HomeService({
    paseoHome,
    manager: agentManager as never,
    logger,
    resolveProviders: (cwd) => resolveTopicTrailProviders(deps.providerSnapshotManager, cwd),
    readPriorities: () => readHomePriorities(paseoHome),
    listCards: async () => {
      const [records, lookup] = await Promise.all([agentStorage.list(), lookups()]);
      const cards: BriefCard[] = [];
      for (const record of records) {
        if (record.archivedAt || record.internal || !record.topicTrail?.card) continue;
        if (hasChiefRoleLabel(record.labels)) continue; // Chief has its own bar, it is not a session to rank
        cards.push({
          id: record.id,
          title: record.title ?? null,
          workspace: lookup.workspaceName(record.workspaceId),
          folder: lookup.folderName(record.workspaceId),
          state: deriveSessionState({
            status: record.lastStatus,
            requiresAttention: record.requiresAttention,
            attentionReason: record.attentionReason,
          }),
          card: record.topicTrail.card,
          lastActivityAt: Date.parse(record.lastActivityAt ?? record.updatedAt) || 0,
        });
      }
      return cards;
    },
    listRecentClosed: async (offset, limit) => {
      const [records, lookup] = await Promise.all([agentStorage.list(), lookups()]);
      const closed = records
        .filter(
          (record) =>
            !record.internal &&
            record.archivedAt &&
            !hasChiefRoleLabel(record.labels) &&
            Date.parse(record.lastUserMessageAt ?? "") > 0,
        )
        .sort(
          (a, b) =>
            Date.parse(b.lastUserMessageAt ?? "") - Date.parse(a.lastUserMessageAt ?? "") ||
            Date.parse(b.archivedAt ?? "") - Date.parse(a.archivedAt ?? ""),
        );
      const items = closed.slice(offset, offset + limit).map((record) => {
        const card = record.topicTrail?.card;
        const place = [lookup.folderName(record.workspaceId), lookup.workspaceName(record.workspaceId)]
          .filter((part): part is string => Boolean(part))
          .join(" › ");
        return {
          agentId: record.id,
          title:
            card?.title?.trim() || card?.what?.trim() || record.title?.trim() || record.id.slice(0, 8),
          workspaceId: record.workspaceId ?? null,
          place: place || null,
          lastUserMessageAt: record.lastUserMessageAt ?? "",
          lastActivityAt: record.lastActivityAt ?? record.updatedAt,
          archivedAt: record.archivedAt ?? "",
        };
      });
      return { items, hasMore: closed.length > offset + limit };
    },
    countClosedToday: async () => {
      const since = startOfLocalDay(new Date());
      const records = await agentStorage.list();
      return records.filter(
        (record) => !record.internal && record.archivedAt && Date.parse(record.archivedAt) >= since,
      ).length;
    },
  });

  return {
    homeService,
    topicTrailOptions: {
      loadAgent: (agentId) => ensureAgentLoaded(agentId, { agentManager, agentStorage, logger }),
      unloadAgent: (agentId) => agentManager.closeAgent(agentId),
      describeSession: async (agentId) => {
        const [record, lookup] = await Promise.all([agentStorage.get(agentId), lookups()]);
        return {
          workspace: lookup.workspaceName(record?.workspaceId),
          folder: lookup.folderName(record?.workspaceId),
        };
      },
      readPriorities: () => readHomePriorities(paseoHome),
      onCardChanged: () => homeService.noteCardsChanged(),
      setAutoTitle: (agentId, title) => agentManager.setAutoTitle(agentId, title),
    },
  };
}

