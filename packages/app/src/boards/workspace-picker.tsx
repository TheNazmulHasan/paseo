import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ProjectIconView } from "@/components/project-icon-view";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import { useArrangeViewportStore } from "@/arrange/viewport";
import { addWorkspacesToBoard, splitWorkspaces, useBoard } from "@/boards/controller";
import { navigateToBoard } from "@/boards/navigation";
import { boardWorkspaceKey } from "@/boards/screen-helpers";
import { closeSplitPicker, useSplitPickerStore } from "@/boards/split-picker-store";
import { useSplitPickerWorkspaces } from "@/boards/use-split-picker-workspaces";
import {
  canSplit,
  filterPickerWorkspaces,
  layoutForEnter,
  moveHighlight,
  newPickedKeys,
  resolveSplitViewport,
  togglePickedKeyUnlessLocked,
  type PickerWorkspace,
  type SplitLayoutChoice,
} from "@/boards/workspace-picker-model";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { Theme } from "@/styles/theme";

const ThemedCheck = withUnistyles(Check);
const checkedIconMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const ICON_SIZE = 20;

function isTypingSurface(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return true;
  }
  return target === document.body || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

/** Space checks the highlighted row, arrows move it, Enter splits as columns, Shift+Enter as grid. */
function usePickerKeys(input: {
  visible: boolean;
  onMove: (delta: number) => void;
  onToggleHighlighted: () => void;
  onConfirm: (layout: SplitLayoutChoice) => void;
}): void {
  const { visible, onMove, onToggleHighlighted, onConfirm } = input;
  useEffect(() => {
    if (!visible || !isWeb || typeof document === "undefined") {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || !isTypingSurface(event.target)) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        onMove(event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === " ") {
        // The filter matches word by word, so giving up the space bar there costs nothing.
        event.preventDefault();
        onToggleHighlighted();
      } else if (event.key === "Enter") {
        event.preventDefault();
        onConfirm(layoutForEnter(event.shiftKey));
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onConfirm, onMove, onToggleHighlighted, visible]);
}

const PickerRow = memo(function PickerRow({
  item,
  index,
  order,
  locked,
  highlighted,
  onToggle,
  onHover,
}: {
  item: PickerWorkspace;
  index: number;
  /** 1-based position in the pick order, or 0 when unchecked. */
  order: number;
  /** Add mode: already in the view, so checked and not changeable. */
  locked: boolean;
  highlighted: boolean;
  onToggle: (key: string) => void;
  onHover: (index: number) => void;
}) {
  const checked = order > 0;
  const handlePress = useCallback(() => onToggle(item.key), [item.key, onToggle]);
  const handleHover = useCallback(() => onHover(index), [index, onHover]);
  const accessibilityState = useMemo(() => ({ checked, disabled: locked }), [checked, locked]);
  const rowStyle = useMemo(
    () => [styles.row, highlighted && styles.rowHighlighted, locked && styles.rowLocked],
    [highlighted, locked],
  );
  const boxStyle = useMemo(() => [styles.checkbox, checked && styles.checkboxChecked], [checked]);
  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      disabled={locked}
      onHoverIn={handleHover}
      accessibilityRole="checkbox"
      accessibilityLabel={item.title}
      accessibilityState={accessibilityState}
      aria-checked={checked}
      testID={`split-picker-row-${item.key}`}
    >
      <View style={boxStyle}>
        {checked ? <ThemedCheck size={14} uniProps={checkedIconMapping} /> : null}
      </View>
      <ProjectIconView
        iconDataUri={item.iconDataUri}
        initial={item.initial}
        projectViewKey={item.projectViewKey}
        size={ICON_SIZE}
        textStyle={styles.iconFallbackText}
      />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {item.projectName}
        </Text>
      </View>
      {checked ? <Text style={styles.order}>{order}</Text> : null}
    </Pressable>
  );
});

/**
 * "Split workspaces": check two or more workspaces (the current one starts checked), then lay
 * them side by side as columns or as a grid. Each becomes one pane of a view holding that
 * workspace's sessions. Opened by Ctrl+Cmd+O, the Arrange menu and the Command Center.
 */
export function WorkspacePicker() {
  const { t } = useTranslation();
  const visible = useSplitPickerStore((state) => state.open);
  const addToBoardId = useSplitPickerStore((state) => state.addToBoardId);
  const addBoard = useBoard(addToBoardId);
  const adding = addBoard !== null;
  // Add mode: the workspaces the view already shows are checked and locked.
  const lockedKeys = useMemo<ReadonlySet<string>>(
    () => new Set(addBoard ? Object.values(addBoard.origins).map(boardWorkspaceKey) : []),
    [addBoard],
  );
  const lockedKeysRef = useRef(lockedKeys);
  lockedKeysRef.current = lockedKeys;
  const selection = useActiveWorkspaceSelection();
  const currentKey = selection ? `${selection.serverId}:${selection.workspaceId}` : null;
  const workspaces = useSplitPickerWorkspaces({ enabled: visible, currentKey });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;

  // Seeded when the dialog opens, never while it is open: a background list refresh must not
  // throw away what the user has checked.
  useEffect(() => {
    if (!visible) {
      return;
    }
    setQuery("");
    setHighlight(0);
    const locked = [...lockedKeysRef.current];
    if (locked.length > 0) {
      setPicked(locked);
    } else {
      setPicked(currentKeyRef.current ? [currentKeyRef.current] : []);
    }
  }, [visible, addToBoardId]);

  const filtered = useMemo(() => filterPickerWorkspaces(workspaces, query), [query, workspaces]);
  const safeHighlight = Math.min(highlight, Math.max(filtered.length - 1, 0));
  const orderByKey = useMemo(
    () => new Map(picked.map((key, index) => [key, index + 1] as const)),
    [picked],
  );
  const splittable = adding ? newPickedKeys(picked, lockedKeys).length > 0 : canSplit(picked);

  const handleQuery = useCallback((value: string) => {
    setQuery(value);
    setHighlight(0);
  }, []);
  const handleToggle = useCallback((key: string) => {
    setPicked((current) => togglePickedKeyUnlessLocked(current, key, lockedKeysRef.current));
  }, []);
  const handleMove = useCallback(
    (delta: number) => setHighlight((index) => moveHighlight(index, delta, filtered.length)),
    [filtered.length],
  );
  const handleToggleHighlighted = useCallback(() => {
    const row = filtered[safeHighlight];
    if (row) {
      handleToggle(row.key);
    }
  }, [filtered, handleToggle, safeHighlight]);

  const confirm = useCallback(
    (layout: SplitLayoutChoice) => {
      const byKey = new Map(workspaces.map((workspace) => [workspace.key, workspace] as const));
      const toRefs = (keys: readonly string[]) =>
        keys.flatMap((key) => {
          const workspace = byKey.get(key);
          return workspace
            ? [{ serverId: workspace.serverId, workspaceId: workspace.workspaceId }]
            : [];
        });
      const measured = currentKeyRef.current
        ? useArrangeViewportStore.getState().byWorkspace[currentKeyRef.current]
        : null;
      const { width, height } = Dimensions.get("window");
      const viewport = resolveSplitViewport({ measured, windowSize: { width, height } });
      if (addToBoardId) {
        const added = toRefs(newPickedKeys(picked, lockedKeysRef.current));
        if (added.length === 0) {
          return;
        }
        addWorkspacesToBoard(addToBoardId, added, viewport);
        closeSplitPicker();
        return;
      }
      if (!canSplit(picked)) {
        return;
      }
      const chosen = toRefs(picked);
      if (chosen.length < 2) {
        return;
      }
      const boardId = splitWorkspaces({ workspaces: chosen, layout, viewport });
      closeSplitPicker();
      if (boardId) {
        navigateToBoard(boardId);
      }
    },
    [addToBoardId, picked, workspaces],
  );
  const handleColumns = useCallback(() => confirm("columns"), [confirm]);
  const handleGrid = useCallback(() => confirm("grid"), [confirm]);
  usePickerKeys({
    visible,
    onMove: handleMove,
    onToggleHighlighted: handleToggleHighlighted,
    onConfirm: confirm,
  });

  const header = useMemo<SheetHeader>(
    () => ({
      title: t(adding ? "boards.picker.addTitle" : "boards.picker.title"),
      search: {
        onChange: handleQuery,
        placeholder: t("boards.picker.searchPlaceholder"),
        autoFocus: true,
        testID: "split-picker-search",
      },
    }),
    [adding, handleQuery, t],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Text style={styles.hint} numberOfLines={2}>
          {adding
            ? t(splittable ? "boards.picker.addHint" : "boards.picker.addNone", {
                count: newPickedKeys(picked, lockedKeys).length,
              })
            : t(splittable ? "boards.picker.hint" : "boards.picker.needTwo", {
                count: picked.length,
              })}
        </Text>
        <View style={styles.footerButtons}>
          <Button
            style={styles.footerButton}
            variant="default"
            disabled={!splittable}
            onPress={handleColumns}
            testID={adding ? "split-picker-add" : "split-picker-columns"}
          >
            {t(adding ? "boards.picker.add" : "boards.picker.columns")}
          </Button>
          {adding ? null : (
            <Button
              style={styles.footerButton}
              variant="secondary"
              disabled={!splittable}
              onPress={handleGrid}
              testID="split-picker-grid"
            >
              {t("boards.picker.grid")}
            </Button>
          )}
        </View>
      </View>
    ),
    [adding, handleColumns, handleGrid, lockedKeys, picked, splittable, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={closeSplitPicker}
      footer={footer}
      testID={adding ? "split-picker-add-mode" : "split-picker"}
    >
      {filtered.length === 0 ? (
        <Text style={styles.empty} testID="split-picker-empty">
          {t("boards.picker.empty")}
        </Text>
      ) : (
        filtered.map((item, index) => (
          <PickerRow
            key={item.key}
            item={item}
            index={index}
            order={orderByKey.get(item.key) ?? 0}
            locked={lockedKeys.has(item.key)}
            highlighted={index === safeHighlight}
            onToggle={handleToggle}
            onHover={setHighlight}
          />
        ))
      )}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  rowHighlighted: { backgroundColor: theme.colors.surface3 },
  rowLocked: { opacity: 0.55 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  iconFallbackText: { fontSize: 11 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  rowSubtitle: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  order: {
    minWidth: 18,
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  empty: {
    padding: theme.spacing[3],
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  footer: { flex: 1, gap: theme.spacing[2] },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  footerButtons: { flexDirection: "row", gap: theme.spacing[3] },
  footerButton: { flex: 1 },
}));
