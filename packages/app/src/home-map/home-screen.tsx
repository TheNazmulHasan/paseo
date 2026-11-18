import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { KeyboardAvoidingView, Platform, Text, View, type LayoutChangeEvent } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollView } from "@/components/ui/scroll-view";
import { isWeb } from "@/constants/platform";
import { useHosts } from "@/runtime/host-runtime";
import { ChiefBar } from "./chief-bar";
import { ChiefDrawer } from "./chief-drawer";
import { HomeHeader } from "./home-header";
import { HomeHostSync } from "./home-host-sync";
import type { HomeKeyAction, HomeOverlay } from "./keys";
import { markLandedOnHome } from "./launch";
import { useHomeStore } from "./home-store";
import type { HomeSession } from "./model";
import type { ClosedRecent } from "./recent";
import { QueueSection, type QueueActions } from "./queue-section";
import { RightColumn, type RightColumnActions } from "./right-column";
import { advanceSweep, resolveSweep, startSweep, type SweepState } from "./sweep";
import { SweepView } from "./sweep-view";
import { useHomeActions } from "./use-home-actions";
import { useHomeBacklog } from "./use-home-backlog";
import { useHomeData } from "./use-home-data";
import { useHomeKeys } from "./use-home-keys";
import { useHomeRecent } from "./use-home-recent";
import {
  buildQueueModel,
  itemHasActions,
  visibleQueueItems,
  type QueueItemModel,
} from "./view-model";

/** Two columns from this body width; below it (a phone, a narrow window) they stack. */
const WIDE_MIN_WIDTH = 760;
const CONTENT_MAX_WIDTH = 1240;

function nextLaterMenuId(current: string | null, sessionId: string, open: boolean): string | null {
  if (open) return sessionId;
  return current === sessionId ? null : current;
}

function overlayOf(sweeping: boolean, drawerOpen: boolean): HomeOverlay {
  if (sweeping) return "sweep";
  return drawerOpen ? "drawer" : "none";
}

/**
 * Home (fork mod, home-map), v2: a briefing, not an inventory. Header (headline, tally), then two
 * columns: Your queue on the left, what moves without him on the right (Recently worked on,
 * Running now, Check on these, Backlog, Tidy); the send-only Chief bar is docked at the bottom.
 * Every open session sits in exactly one place (the shared `buildHomeView`). Drawn from the live
 * stores plus each host's Home snapshot, so it updates with no polling beyond a quiet minute tick.
 */
export function HomeScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return <HomeScreenContent />;
}

function HomeScreenContent(): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const data = useHomeData();
  const { view, merged, closedToday, chief, loading, now } = data;
  const actions = useHomeActions();
  const backlog = useHomeBacklog();

  const [bodyWidth, setBodyWidth] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsedOpen, setCollapsedOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [laterMenuId, setLaterMenuId] = useState<string | null>(null);
  const [sweep, setSweep] = useState<SweepState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const wide = bodyWidth >= WIDE_MIN_WIDTH;

  // The cold-start redirect has done its job once Home is on screen; later visits to the index
  // route restore the last workspace as upstream does (see `launch.ts`).
  useEffect(() => {
    markLandedOnHome();
  }, []);

  const queueSort = useHomeStore((state) => state.queueSort);
  const setQueueSort = useHomeStore((state) => state.setQueueSort);
  // The order is recomputed from the view, so it follows every card and brief change for free.
  const model = useMemo(() => buildQueueModel(view, queueSort), [view, queueSort]);
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const recent = useHomeRecent({ open: view.recentAll, serverIds, resetKey: closedToday });
  const items = useMemo(() => visibleQueueItems(model, collapsedOpen), [model, collapsedOpen]);
  const focusedIndex = useMemo(
    () => (focusedId ? items.findIndex((item) => item.entry.session.id === focusedId) : -1),
    [items, focusedId],
  );
  const focusedItem: QueueItemModel | null = focusedIndex >= 0 ? items[focusedIndex] : null;

  // Sweep: the list is frozen at the start; sessions that went away meanwhile are skipped.
  const sweepPosition = useMemo(() => {
    if (!sweep) return null;
    return resolveSweep(sweep, new Set(view.checkOn.map((entry) => entry.session.id)));
  }, [sweep, view.checkOn]);
  const sweepEntry = useMemo(
    () =>
      sweepPosition?.currentId
        ? (view.checkOn.find((entry) => entry.session.id === sweepPosition.currentId) ?? null)
        : null,
    [sweepPosition, view.checkOn],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await actions.refresh();
    } finally {
      setRefreshing(false);
    }
  }, [actions]);

  const handleLaterOpenChange = useCallback((sessionId: string, open: boolean) => {
    setLaterMenuId((current) => nextLaterMenuId(current, sessionId, open));
  }, []);
  const toggleCollapsed = useCallback(() => setCollapsedOpen((value) => !value), []);
  const startSweepNow = useCallback(
    () => setSweep(startSweep(view.checkOn.map((entry) => entry.session.id))),
    [view.checkOn],
  );
  const exitSweep = useCallback(() => setSweep(null), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const closeOne = useCallback((session: HomeSession) => void actions.close([session]), [actions]);
  const snoozeOne = useCallback(
    (session: HomeSession, preset: Parameters<typeof actions.snooze>[1]) =>
      void actions.snooze(session, preset),
    [actions],
  );
  const unsnoozeOne = useCallback(
    (session: HomeSession) => void actions.unsnooze(session),
    [actions],
  );
  const backToNormal = useCallback(() => void actions.backToNormal(), [actions]);

  const queueActions = useMemo<QueueActions>(
    () => ({
      open: actions.open,
      close: closeOne,
      snooze: snoozeOne,
      unsnooze: unsnoozeOne,
      backToNormal,
    }),
    [actions.open, backToNormal, closeOne, snoozeOne, unsnoozeOne],
  );
  const { dropClosed } = recent;
  const reopenClosed = useCallback(
    (item: ClosedRecent) => {
      void actions.reopen(item).then((ok) => {
        if (ok) dropClosed(item.serverId, item.agentId);
        return undefined;
      });
    },
    [actions, dropClosed],
  );
  const rightActions = useMemo<RightColumnActions>(
    () => ({
      open: actions.open,
      close: (sessions) => void actions.close(sessions),
      startSweep: startSweepNow,
      reopen: reopenClosed,
    }),
    [actions, reopenClosed, startSweepNow],
  );
  const recentProps = useMemo(
    () => ({ rows: recent.rows, canShowMore: recent.canShowMore, onShowMore: recent.showMore }),
    [recent.rows, recent.canShowMore, recent.showMore],
  );

  const handleSweepKeep = useCallback(() => {
    if (!sweepEntry || !sweepPosition) return;
    void actions.keep(sweepEntry.session);
    setSweep(advanceSweep(sweepPosition.state));
  }, [actions, sweepEntry, sweepPosition]);
  const handleSweepClose = useCallback(() => {
    if (!sweepEntry || !sweepPosition) return;
    void actions.close([sweepEntry.session]);
    setSweep(advanceSweep(sweepPosition.state));
  }, [actions, sweepEntry, sweepPosition]);
  const handleSweepOpen = useCallback(() => {
    if (sweepEntry) actions.open(sweepEntry.session);
  }, [actions, sweepEntry]);

  const handleKeyAction = useCallback(
    (action: HomeKeyAction) => {
      switch (action.type) {
        case "focus":
          setFocusedId(items[action.index]?.entry.session.id ?? null);
          return;
        case "open":
          if (focusedItem) actions.open(focusedItem.entry.session);
          return;
        case "later":
          if (focusedItem) setLaterMenuId(focusedItem.entry.session.id);
          return;
        case "close": {
          if (!focusedItem) return;
          // Move the focus on, so C C C works down the list.
          const next = items[focusedIndex + 1] ?? items[focusedIndex - 1] ?? null;
          setFocusedId(next ? next.entry.session.id : null);
          void actions.close([focusedItem.entry.session]);
          return;
        }
        case "escape":
          if (sweep) setSweep(null);
          else setDrawerOpen(false);
          return;
        case "sweep-keep":
          handleSweepKeep();
          return;
        case "sweep-close":
          handleSweepClose();
          return;
        case "sweep-open":
          handleSweepOpen();
          return;
      }
    },
    [
      actions,
      focusedIndex,
      focusedItem,
      handleSweepClose,
      handleSweepKeep,
      handleSweepOpen,
      items,
      sweep,
    ],
  );
  useHomeKeys(
    () => ({
      itemCount: Math.min(9, items.length),
      focusedIndex: focusedIndex >= 0 ? focusedIndex : null,
      focusedHasActions: focusedItem ? itemHasActions(model, focusedItem) : false,
      menuOpen: laterMenuId !== null,
      overlay: overlayOf(Boolean(sweep), drawerOpen),
    }),
    handleKeyAction,
  );

  const handleBodyLayout = useCallback((event: LayoutChangeEvent) => {
    setBodyWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      testID="home-screen"
    >
      <MenuHeader title={t("homeMap.title")} />
      {hosts.map((host) => (
        <HomeHostSync key={host.serverId} serverId={host.serverId} />
      ))}
      {loading ? (
        <View style={styles.loading} testID="home-loading">
          <ThemedSpinner size="large" />
          <Text style={styles.loadingText}>{t("homeMap.loading")}</Text>
        </View>
      ) : (
        <View style={styles.body} onLayout={handleBodyLayout}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            testID="home-scroll"
          >
            <View style={styles.column}>
              <HomeHeader
                now={now}
                headline={view.headline}
                since={view.since}
                generatedAt={view.generatedAt}
                briefRunning={merged.briefRunning}
                tally={view.tally}
                closedToday={closedToday}
                refreshing={refreshing}
                onRefresh={handleRefresh}
              />
              {sweep && sweepPosition ? (
                <SweepView
                  entry={sweepEntry}
                  position={sweepPosition.position}
                  total={sweepPosition.total}
                  onKeep={handleSweepKeep}
                  onClose={handleSweepClose}
                  onOpen={handleSweepOpen}
                  onExit={exitSweep}
                />
              ) : (
                <View style={wide ? styles.columns : styles.stack}>
                  <View style={wide ? styles.left : styles.full}>
                    <QueueSection
                      model={model}
                      snoozed={view.snoozed}
                      focusedId={focusedId}
                      laterMenuId={laterMenuId}
                      onLaterOpenChange={handleLaterOpenChange}
                      collapsedOpen={collapsedOpen}
                      onToggleCollapsed={toggleCollapsed}
                      sort={queueSort}
                      onSortChange={setQueueSort}
                      actions={queueActions}
                    />
                  </View>
                  <View style={wide ? styles.right : styles.full}>
                    <RightColumn
                      view={view}
                      recent={recentProps}
                      backlog={backlog}
                      actions={rightActions}
                    />
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
          {drawerOpen && chief ? <ChiefDrawer chief={chief} onClose={closeDrawer} /> : null}
        </View>
      )}
      <ChiefBar chief={chief} onRead={openDrawer} />
      {isWeb ? (
        <Text style={styles.keysHint} testID="home-keys-hint">
          {t("homeMap.keysHint")}
        </Text>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    alignItems: "center",
    paddingVertical: theme.spacing[3],
  },
  // One horizontal inset for the whole Home body (header, both columns); the Chief bar uses the
  // same value so everything lines up. Inside the column so it holds at any window width.
  column: {
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    paddingHorizontal: theme.spacing[6],
    gap: theme.spacing[3],
    minWidth: 0,
  },
  columns: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[6],
    minWidth: 0,
  },
  stack: {
    gap: theme.spacing[4],
    minWidth: 0,
  },
  // Left 1.55fr, right 1fr.
  left: {
    flexGrow: 1.55,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  right: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  full: {
    width: "100%",
    minWidth: 0,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  loadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  keysHint: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[1.5],
    backgroundColor: theme.colors.surface0,
  },
}));
