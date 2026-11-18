import { memo, useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { HomeSnoozePreset } from "@getpaseo/protocol/home";
import type { Theme } from "@/styles/theme";
import { PressHighlight } from "@/components/ui/press-highlight";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { HomeButton } from "./home-button";
import { sessionLocation, type HomeSession } from "./model";
import { QueueItem } from "./queue-item";
import {
  describeSnoozeBack,
  formatClock,
  type HomeSessionEntry,
  type QueueBlock,
  type QueueModel,
  type QueueSort,
} from "./view-model";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface QueueActions {
  open: (session: HomeSession) => void;
  close: (session: HomeSession) => void;
  snooze: (session: HomeSession, preset: HomeSnoozePreset) => void;
  unsnooze: (session: HomeSession) => void;
  backToNormal: () => void;
}

function useWhenLabel(): (untilMs: number) => string {
  const { t } = useTranslation();
  return useCallback(
    (untilMs: number) => {
      const back = describeSnoozeBack(untilMs, new Date());
      if (back.kind === "today") return t("homeMap.queue.backToday", { time: back.time });
      if (back.kind === "tomorrow") return t("homeMap.queue.backTomorrow", { time: back.time });
      return t("homeMap.queue.backDate", {
        date: back.date.toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
        time: back.time,
      });
    },
    [t],
  );
}

function blockLabel(block: QueueBlock, t: (key: string) => string): string | null {
  if (block.label) return block.label;
  if (block.labelKey === "unfiled") return t("homeMap.queue.unfiled");
  return block.labelKey ? t(`homeMap.queue.priority.${block.labelKey}`) : null;
}

/** The sort switch: always visible in the queue header, four small segments. */
const SortSwitch = memo(function SortSwitch({
  sort,
  onChange,
}: {
  sort: QueueSort;
  onChange: (sort: QueueSort) => void;
}) {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<QueueSort>[]>(
    () =>
      (["priority", "waiting", "folder", "recent"] as const).map((value) => ({
        value,
        label: t(`homeMap.queue.sort.${value}`),
        testID: `home-queue-sort-${value}`,
      })),
    [t],
  );
  return (
    <SegmentedControl
      size="sm"
      options={options}
      value={sort}
      onValueChange={onChange}
      testID="home-queue-sort"
    />
  );
});

function BlockView({
  block,
  hasActions,
  focusedId,
  laterMenuId,
  onLaterOpenChange,
  actions,
}: {
  block: QueueBlock;
  hasActions: boolean;
  focusedId: string | null;
  laterMenuId: string | null;
  onLaterOpenChange: (sessionId: string, open: boolean) => void;
  actions: QueueActions;
}) {
  const { t } = useTranslation();
  const label = blockLabel(block, t);
  return (
    <View
      style={[
        styles.group,
        block.tint === "now" ? styles.groupNow : null,
        block.tint === "today" ? styles.groupToday : null,
      ]}
      testID={`home-queue-group-${block.key}`}
    >
      {label ? <Text style={styles.groupLabel}>{label}</Text> : null}
      {block.items.map((item) => (
        <QueueItem
          key={item.entry.session.id}
          item={item}
          hasActions={hasActions}
          focused={focusedId === item.entry.session.id}
          laterOpen={laterMenuId === item.entry.session.id}
          onLaterOpenChange={onLaterOpenChange}
          onOpen={actions.open}
          onClose={actions.close}
          onSnooze={actions.snooze}
        />
      ))}
    </View>
  );
}

/** "3 put off with Later: back tomorrow 09:00 · Show", and the list behind Show. */
const SnoozedLine = memo(function SnoozedLine({
  entries,
  actions,
}: {
  entries: readonly HomeSessionEntry[];
  actions: QueueActions;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const toggle = useCallback(() => setShown((value) => !value), []);
  const whenLabel = useWhenLabel();
  if (entries.length === 0) return null;
  const earliest = entries.reduce((min, entry) => Math.min(min, entry.until ?? min), Infinity);
  return (
    <View style={styles.snoozed} testID="home-snoozed">
      <View style={styles.snoozedLine}>
        <Text style={styles.snoozedText}>
          {t("homeMap.queue.putOff", { count: entries.length, when: whenLabel(earliest) })}
        </Text>
        <HomeButton kind="quiet" onPress={toggle} testID="home-snoozed-toggle">
          {shown ? t("homeMap.hide") : t("homeMap.show")}
        </HomeButton>
      </View>
      {shown
        ? entries.map((entry) => (
            <SnoozedRow key={entry.session.id} entry={entry} actions={actions} />
          ))
        : null}
    </View>
  );
});

const SnoozedRow = memo(function SnoozedRow({
  entry,
  actions,
}: {
  entry: HomeSessionEntry;
  actions: QueueActions;
}) {
  const { t } = useTranslation();
  const whenLabel = useWhenLabel();
  const session = entry.session;
  const location = sessionLocation(session);
  const handleOpen = useCallback(() => actions.open(session), [actions, session]);
  const handleBack = useCallback(() => actions.unsnooze(session), [actions, session]);
  return (
    <View style={styles.snoozedRow}>
      <View style={styles.snoozedBody}>
        <Text style={styles.snoozedName} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={styles.snoozedMeta} numberOfLines={1}>
          {[location, entry.until ? whenLabel(entry.until) : null].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <HomeButton kind="go" onPress={handleOpen}>
        {t("homeMap.queue.open")}
      </HomeButton>
      <HomeButton kind="quiet" onPress={handleBack} testID={`home-unsnooze-${session.id}`}>
        {t("homeMap.queue.bringBack")}
      </HomeButton>
    </View>
  );
});

/**
 * Left column: Your queue, with a sort switch (Priority, Waiting longest, Folder, Recent). In
 * Priority the first group is tinted strongly, the second faintly, and "Neither" sits behind
 * "N more can wait". With a Chief layout the layout replaces the queue (its own title, its
 * groups, "Back to normal"), and the queue sessions it left out wait collapsed underneath.
 */
export const QueueSection = memo(function QueueSection({
  model,
  snoozed,
  focusedId,
  laterMenuId,
  onLaterOpenChange,
  collapsedOpen,
  onToggleCollapsed,
  sort,
  onSortChange,
  actions,
}: {
  model: QueueModel;
  snoozed: readonly HomeSessionEntry[];
  focusedId: string | null;
  laterMenuId: string | null;
  onLaterOpenChange: (sessionId: string, open: boolean) => void;
  collapsedOpen: boolean;
  onToggleCollapsed: () => void;
  sort: QueueSort;
  onSortChange: (sort: QueueSort) => void;
  actions: QueueActions;
}) {
  const { t } = useTranslation();
  const isLayout = model.mode === "layout";
  const collapsed = model.collapsed;
  const madeAt = model.layout ? formatClock(model.layout.createdAt) : null;
  const handleBack = useCallback(() => actions.backToNormal(), [actions]);
  const collapsedState = useMemo(() => ({ expanded: collapsedOpen }), [collapsedOpen]);

  return (
    <View style={styles.section} testID="home-queue">
      {model.layout ? (
        <View style={styles.layoutHeader} testID="home-layout-header">
          <Text style={styles.title}>{model.layout.title}</Text>
          <Text style={styles.layoutNote}>
            {[t("homeMap.queue.madeBy", { time: madeAt ?? "" }), model.layout.reason]
              .filter((part) => part.trim().length > 0)
              .join(" ")}
          </Text>
          <HomeButton kind="plain" onPress={handleBack} testID="home-back-to-normal">
            {t("homeMap.queue.backToNormal")}
          </HomeButton>
        </View>
      ) : (
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t("homeMap.queue.title")}</Text>
          <SortSwitch sort={sort} onChange={onSortChange} />
        </View>
      )}

      {model.blocks.length === 0 && !collapsed ? (
        <Text style={styles.empty} testID="home-queue-empty">
          {t("homeMap.queue.empty")}
        </Text>
      ) : null}

      {model.blocks.map((block) => (
        <BlockView
          key={block.key}
          block={block}
          hasActions={!isLayout}
          focusedId={focusedId}
          laterMenuId={laterMenuId}
          onLaterOpenChange={onLaterOpenChange}
          actions={actions}
        />
      ))}

      {collapsed ? (
        <View>
          <PressHighlight
            style={styles.summary}
            onPress={onToggleCollapsed}
            accessibilityRole="button"
            accessibilityState={collapsedState}
            testID="home-queue-later-toggle"
          >
            {collapsedOpen ? (
              <ThemedChevronDown size={14} uniProps={mutedMapping} />
            ) : (
              <ThemedChevronRight size={14} uniProps={mutedMapping} />
            )}
            <Text style={styles.summaryText}>
              {isLayout
                ? t("homeMap.queue.restOfQueue", { count: collapsed.items.length })
                : t("homeMap.queue.moreCanWait", { count: collapsed.items.length })}
            </Text>
          </PressHighlight>
          {collapsedOpen ? (
            <BlockView
              block={collapsed}
              hasActions
              focusedId={focusedId}
              laterMenuId={laterMenuId}
              onLaterOpenChange={onLaterOpenChange}
              actions={actions}
            />
          ) : null}
        </View>
      ) : null}

      <SnoozedLine entries={snoozed} actions={actions} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[1.5],
    minWidth: 0,
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  titleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  layoutHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  layoutNote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[2],
  },
  group: {
    borderRadius: theme.borderRadius.lg,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[0.5],
    gap: 2,
  },
  // Urgency is the one tinted dimension: Now strong, Today faint.
  groupNow: {
    backgroundColor: `${theme.colors.statusDotWarning}26`,
  },
  groupToday: {
    backgroundColor: `${theme.colors.statusDotWarning}0f`,
  },
  groupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    paddingHorizontal: theme.spacing[2],
    paddingTop: 2,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
  },
  summaryText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  snoozed: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  snoozedLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  snoozedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  snoozedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[0.5],
  },
  snoozedBody: {
    flex: 1,
    minWidth: 0,
  },
  snoozedName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  snoozedMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
