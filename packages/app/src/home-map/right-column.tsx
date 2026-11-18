import { memo, useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { router, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { MasterBacklogTask } from "@/tasks/master-backlog";
import { buildBacklogRoute } from "@/utils/host-routes";
import { HomeButton } from "./home-button";
import { sessionLocation, type HomeSession } from "./model";
import { HOME_RECENT_PAGE, type ClosedRecent, type RecentRow } from "./recent";
import { ActivityAge, StateDot } from "./state-dot";
import type { HomeBacklog } from "./use-home-backlog";
import {
  BACKLOG_VISIBLE,
  describeItem,
  describeTidy,
  splitCheckOn,
  type HomeSessionEntry,
  type HomeSessionView,
} from "./view-model";

export interface RightColumnActions {
  open: (session: HomeSession) => void;
  close: (sessions: readonly HomeSession[]) => void;
  startSweep: () => void;
  /** Unarchives a closed session and opens it. */
  reopen: (item: ClosedRecent) => void;
}

export interface RecentProps {
  rows: readonly RecentRow[];
  canShowMore: boolean;
  onShowMore: () => void;
}

function Block({
  title,
  testID,
  children,
}: {
  title: string;
  testID: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.block} testID={testID}>
      <Text style={styles.heading}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * One line of the right column: a dot, the bold name (`entry.title`), then `Folder › Workspace`
 * and the status. Pressing the row opens the session; `buttons` are the always-visible actions.
 */
const SessionRow = memo(function SessionRow({
  entry,
  onOpen,
  onClose,
  buttons = "none",
  withAge = true,
  extraStatus,
  testID,
}: {
  entry: HomeSessionEntry;
  onOpen: (session: HomeSession) => void;
  onClose?: (sessions: readonly HomeSession[]) => void;
  /** The always-visible buttons on the row: none, Open, or Open and Close. */
  buttons?: "none" | "open" | "open-close";
  withAge?: boolean;
  extraStatus?: string | null;
  testID: string;
}) {
  const session = entry.session;
  const text = describeItem(entry, { withNextStep: false, withWhy: false });
  const location = sessionLocation(session);
  const handlePress = useCallback(() => onOpen(session), [onOpen, session]);
  const meta = [location, text.status, extraStatus].filter(Boolean).join(" · ");
  return (
    <PressHighlight
      style={styles.row}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={text.name}
      testID={testID}
    >
      <View style={styles.dotSlot}>
        <StateDot state={session.state} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {text.name}
        </Text>
        {meta ? (
          <Text style={styles.rowMeta} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
      </View>
      {buttons === "none" ? null : (
        <View style={styles.rowButtons}>
          <OpenButton session={session} onOpen={onOpen} />
          {buttons === "open-close" && onClose ? (
            <CloseButton session={session} onClose={onClose} />
          ) : null}
        </View>
      )}
      {withAge ? <ActivityAge at={session.lastActivityAt} /> : null}
    </PressHighlight>
  );
});

function OpenButton({
  session,
  onOpen,
}: {
  session: HomeSession;
  onOpen: (session: HomeSession) => void;
}) {
  const { t } = useTranslation();
  const handle = useCallback(() => onOpen(session), [onOpen, session]);
  return (
    <HomeButton kind="go" onPress={handle} testID={`home-open-${session.id}`}>
      {t("homeMap.queue.open")}
    </HomeButton>
  );
}

function CloseButton({
  session,
  onClose,
}: {
  session: HomeSession;
  onClose: (sessions: readonly HomeSession[]) => void;
}) {
  const { t } = useTranslation();
  const handle = useCallback(() => onClose([session]), [onClose, session]);
  return (
    <HomeButton kind="quiet" onPress={handle} testID={`home-close-${session.id}`}>
      {t("homeMap.queue.close")}
    </HomeButton>
  );
}

/** A closed session in Recently worked on: marked "closed", Open reopens it, no Close. */
const ClosedRow = memo(function ClosedRow({
  item,
  onReopen,
}: {
  item: ClosedRecent;
  onReopen: (item: ClosedRecent) => void;
}) {
  const { t } = useTranslation();
  const handle = useCallback(() => onReopen(item), [item, onReopen]);
  const meta = [t("homeMap.recent.closed"), item.place].filter(Boolean).join(" · ");
  return (
    <PressHighlight
      style={styles.row}
      onPress={handle}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      testID={`home-recent-closed-${item.agentId}`}
    >
      <View style={styles.dotSlot}>
        <View style={styles.ring} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <View style={styles.rowButtons}>
        <HomeButton kind="go" onPress={handle} testID={`home-open-closed-${item.agentId}`}>
          {t("homeMap.queue.open")}
        </HomeButton>
      </View>
    </PressHighlight>
  );
});

/**
 * Recently worked on: the last 10 sessions he wrote to, newest first, however important, then
 * "Show 10 more" for as far back as there is. Open ones have Open and Close; closed ones come
 * after them, marked "closed", with Open only.
 */
const RecentBlock = memo(function RecentBlock({
  recent,
  actions,
}: {
  recent: RecentProps;
  actions: RightColumnActions;
}) {
  const { t } = useTranslation();
  if (recent.rows.length === 0) return null;
  return (
    <Block title={t("homeMap.recent.title")} testID="home-recent">
      {recent.rows.map((row) =>
        row.kind === "open" ? (
          <SessionRow
            key={row.key}
            entry={row.entry}
            onOpen={actions.open}
            buttons="open-close"
            onClose={actions.close}
            testID={`home-recent-${row.entry.session.id}`}
          />
        ) : (
          <ClosedRow key={row.key} item={row.item} onReopen={actions.reopen} />
        ),
      )}
      {recent.canShowMore ? (
        <View style={styles.moreRow}>
          <HomeButton kind="plain" onPress={recent.onShowMore} testID="home-recent-more">
            {t("homeMap.recent.showMore", { count: HOME_RECENT_PAGE })}
          </HomeButton>
        </View>
      ) : null}
    </Block>
  );
});

/** Running now: agents working that are not already under Recently worked on. */
const RunningBlock = memo(function RunningBlock({
  entries,
  actions,
}: {
  entries: readonly HomeSessionEntry[];
  actions: RightColumnActions;
}) {
  const { t } = useTranslation();
  if (entries.length === 0) return null;
  return (
    <Block title={t("homeMap.running.title")} testID="home-running">
      {entries.map((entry) => (
        <SessionRow
          key={entry.session.id}
          entry={entry}
          onOpen={actions.open}
          testID={`home-running-${entry.session.id}`}
        />
      ))}
    </Block>
  );
});

const CheckOnBlock = memo(function CheckOnBlock({
  checkOn,
  keptCount,
  keptEntries,
  actions,
}: {
  checkOn: readonly HomeSessionEntry[];
  keptCount: number;
  keptEntries: readonly HomeSessionEntry[];
  actions: RightColumnActions;
}) {
  const { t } = useTranslation();
  const [keptShown, setKeptShown] = useState(false);
  const toggleKept = useCallback(() => setKeptShown((value) => !value), []);
  const { shown, more } = splitCheckOn(checkOn);
  if (checkOn.length === 0 && keptCount === 0) return null;
  return (
    <Block title={t("homeMap.checkOn.title")} testID="home-check-on">
      {checkOn.length > 0 ? <Text style={styles.sub}>{t("homeMap.checkOn.sub")}</Text> : null}
      {shown.map((entry) => (
        <SessionRow
          key={entry.session.id}
          entry={entry}
          onOpen={actions.open}
          withAge={false}
          extraStatus={
            entry.session.card?.looksFinished ? t("homeMap.checkOn.looksFinished") : null
          }
          buttons="open-close"
          onClose={actions.close}
          testID={`home-check-${entry.session.id}`}
        />
      ))}
      {checkOn.length > 0 ? (
        <View style={styles.moreRow}>
          {more > 0 ? (
            <Text style={styles.sub}>{t("homeMap.checkOn.more", { count: more })}</Text>
          ) : null}
          <HomeButton kind="plain" onPress={actions.startSweep} testID="home-sweep-start">
            {t("homeMap.checkOn.sweepThem")}
          </HomeButton>
          <Text style={styles.sub}>{t("homeMap.checkOn.sweepHint")}</Text>
        </View>
      ) : null}
      {keptCount > 0 ? (
        <View style={styles.moreRow} testID="home-kept">
          <Text style={styles.sub}>{t("homeMap.checkOn.kept", { count: keptCount })}</Text>
          <HomeButton kind="quiet" onPress={toggleKept} testID="home-kept-toggle">
            {keptShown ? t("homeMap.hide") : t("homeMap.show")}
          </HomeButton>
        </View>
      ) : null}
      {keptShown
        ? keptEntries.map((entry) => (
            <SessionRow
              key={entry.session.id}
              entry={entry}
              onOpen={actions.open}
              withAge={false}
              buttons="open-close"
              onClose={actions.close}
              testID={`home-kept-${entry.session.id}`}
            />
          ))
        : null}
    </Block>
  );
});

const BacklogRow = memo(function BacklogRow({
  task,
  starting,
  onStart,
}: {
  task: MasterBacklogTask;
  starting: boolean;
  onStart: (task: MasterBacklogTask) => void;
}) {
  const { t } = useTranslation();
  const handleStart = useCallback(() => onStart(task), [onStart, task]);
  const since = new Date(task.createdAt);
  const sinceLabel = Number.isNaN(since.getTime())
    ? null
    : since.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <View style={styles.row} testID={`home-backlog-${task.taskKey}`}>
      <View style={styles.dotSlot}>
        <View style={styles.ring} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {task.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[
            task.projectName,
            sinceLabel ? t("homeMap.notStarted.since", { date: sinceLabel }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <HomeButton
        kind="plain"
        onPress={handleStart}
        loading={starting}
        testID={`home-start-${task.taskKey}`}
      >
        {t("homeMap.notStarted.start")}
      </HomeButton>
    </View>
  );
});

const NotStartedBlock = memo(function NotStartedBlock({ backlog }: { backlog: HomeBacklog }) {
  const { t } = useTranslation();
  const handleOpenBacklog = useCallback(() => router.push(buildBacklogRoute() as Href), []);
  if (!backlog.available || backlog.tasks.length === 0) return null;
  const shown = backlog.tasks.slice(0, BACKLOG_VISIBLE);
  const more = backlog.tasks.length - shown.length;
  return (
    <Block title={t("homeMap.notStarted.title")} testID="home-not-started">
      {shown.map((task) => (
        <BacklogRow
          key={task.taskKey}
          task={task}
          starting={backlog.startingKey === task.taskKey}
          onStart={backlog.start}
        />
      ))}
      {more > 0 ? (
        <View style={styles.moreRow}>
          <Text style={styles.sub}>{t("homeMap.notStarted.more", { count: more })}</Text>
          <HomeButton kind="quiet" onPress={handleOpenBacklog} testID="home-open-backlog">
            {t("homeMap.notStarted.openBacklog")}
          </HomeButton>
        </View>
      ) : null}
    </Block>
  );
});

/** Tidy: crashed and repeated sessions, one Close them button, Show lists them. */
const TidyBlock = memo(function TidyBlock({
  view,
  actions,
}: {
  view: Pick<HomeSessionView, "tidy">;
  actions: RightColumnActions;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const toggle = useCallback(() => setShown((value) => !value), []);
  const tidy = describeTidy(view);
  const handleCloseAll = useCallback(
    () => actions.close(tidy.all.map((entry) => entry.session)),
    [actions, tidy.all],
  );
  if (tidy.all.length === 0) return null;
  const stopped = tidy.stopped.length;
  const repeats = tidy.superseded.length;
  let summary: string;
  if (stopped > 0 && repeats > 0) {
    summary = t("homeMap.tidy.both", { stopped, repeats });
  } else if (stopped > 0) {
    summary = t("homeMap.tidy.stoppedOnly", { count: stopped });
  } else {
    summary = t("homeMap.tidy.repeatsOnly", { count: repeats });
  }
  return (
    <View style={styles.tidy} testID="home-tidy">
      <View style={styles.moreRow}>
        <Text style={styles.sub}>{summary}</Text>
        <HomeButton kind="plain" onPress={handleCloseAll} testID="home-tidy-close">
          {t("homeMap.tidy.closeThem")}
        </HomeButton>
        <HomeButton kind="quiet" onPress={toggle} testID="home-tidy-show">
          {shown ? t("homeMap.hide") : t("homeMap.show")}
        </HomeButton>
      </View>
      {shown
        ? tidy.all.map((entry) => (
            <SessionRow
              key={entry.session.id}
              entry={entry}
              onOpen={actions.open}
              withAge={false}
              buttons="open-close"
              onClose={actions.close}
              testID={`home-tidy-${entry.session.id}`}
            />
          ))
        : null}
    </View>
  );
});

/**
 * Right column: Recently worked on, Running now, Check on these (and the kept line), Backlog,
 * Tidy. Blocks with nothing in them are left out.
 */
export const RightColumn = memo(function RightColumn({
  view,
  recent,
  backlog,
  actions,
}: {
  view: HomeSessionView;
  recent: RecentProps;
  backlog: HomeBacklog;
  actions: RightColumnActions;
}) {
  return (
    <View style={styles.column} testID="home-right-column">
      <RecentBlock recent={recent} actions={actions} />
      <RunningBlock entries={view.runningElsewhere} actions={actions} />
      <CheckOnBlock
        checkOn={view.checkOn}
        keptCount={view.kept.length}
        keptEntries={view.kept}
        actions={actions}
      />
      <NotStartedBlock backlog={backlog} />
      <TidyBlock view={view} actions={actions} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  column: {
    gap: theme.spacing[3],
    minWidth: 0,
  },
  block: {
    gap: theme.spacing[0.5],
    minWidth: 0,
  },
  heading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  sub: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    minWidth: 0,
  },
  dotSlot: {
    width: 10,
    alignItems: "center",
  },
  ring: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: theme.colors.foregroundMuted,
    opacity: 0.6,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  moreRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[0.5],
  },
  tidy: {
    gap: theme.spacing[0.5],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[2],
  },
}));
