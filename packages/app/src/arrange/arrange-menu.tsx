import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  Columns2,
  Columns3,
  Equal,
  Eye,
  LayoutGrid,
  Save,
  Square,
  SquareSplitHorizontal,
  Trash2,
  Undo2,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  applyNamedLayout,
  deleteNamedLayout,
  saveNamedLayout,
  useCanRestoreArrangement,
  useNamedLayouts,
  useWatchModeActive,
} from "@/arrange/controller";
import { useArrangeMenuStore, useArrangeMenuOpen } from "@/arrange/menu-store";
import {
  resolveArrangeMenuKey,
  runArrangeCommand,
  type ArrangeCommand,
} from "@/arrange/run-command";
import { useArrangeSelection, useArrangeSelectionStore } from "@/arrange/selection-store";
import { openSplitPicker } from "@/boards/split-picker-store";
import type { ArrangeViewport, NamedLayoutSummary } from "@/arrange/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { MenuTextField, menuRowContentInset } from "@/components/ui/menu";
import { Shortcut } from "@/components/ui/shortcut";
import { getIsElectron, isWeb } from "@/constants/platform";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { resolveShortcutKeysForAction } from "@/keyboard/keyboard-shortcuts";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";

const ThemedLayoutGrid = withUnistyles(LayoutGrid);
const ThemedSquare = withUnistyles(Square);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedColumns3 = withUnistyles(Columns3);
const ThemedEye = withUnistyles(Eye);
const ThemedUndo2 = withUnistyles(Undo2);
const ThemedEqual = withUnistyles(Equal);
const ThemedSave = withUnistyles(Save);
const ThemedSquareSplitHorizontal = withUnistyles(SquareSplitHorizontal);
const ThemedTrash2 = withUnistyles(Trash2);

const ICON_SIZE = 16;
const ONE_PANE_ICON = <ThemedSquare size={ICON_SIZE} uniProps={mutedIconColorMapping} />;
const COLUMNS_2_ICON = <ThemedColumns2 size={ICON_SIZE} uniProps={mutedIconColorMapping} />;
const COLUMNS_3_ICON = <ThemedColumns3 size={ICON_SIZE} uniProps={mutedIconColorMapping} />;
const GRID_ICON = <ThemedLayoutGrid size={ICON_SIZE} uniProps={mutedIconColorMapping} />;
const WATCH_ICON = <ThemedEye size={ICON_SIZE} uniProps={mutedIconColorMapping} />;
const RESTORE_ICON = <ThemedUndo2 size={ICON_SIZE} uniProps={mutedIconColorMapping} />;
const EQUALIZE_ICON = <ThemedEqual size={ICON_SIZE} uniProps={mutedIconColorMapping} />;
const SAVE_ICON = <ThemedSave size={ICON_SIZE} uniProps={mutedIconColorMapping} />;
const SPLIT_WORKSPACES_ICON = (
  <ThemedSquareSplitHorizontal size={ICON_SIZE} uniProps={mutedIconColorMapping} />
);

const SHORTCUT_HELP_IDS: Record<ArrangeCommand | "menu", string> = {
  single: "workspace-arrange-single",
  columns2: "workspace-arrange-columns2",
  columns3: "workspace-arrange-columns3",
  grid: "workspace-arrange-grid",
  watch: "workspace-arrange-watch",
  restore: "workspace-arrange-restore",
  equalize: "workspace-arrange-equalize",
  menu: "workspace-arrange-menu",
};

type ShortcutChords = Record<ArrangeCommand | "menu", ShortcutKey[][] | null>;

function useArrangeShortcutChords(): ShortcutChords {
  const { overrides } = useKeyboardShortcutOverrides();
  return useMemo(() => {
    const platform = { isMac: getShortcutOs() === "mac", isDesktop: getIsElectron() };
    const chords = {} as ShortcutChords;
    for (const [command, helpId] of Object.entries(SHORTCUT_HELP_IDS)) {
      chords[command as ArrangeCommand | "menu"] = resolveShortcutKeysForAction(
        helpId,
        overrides,
        platform,
      );
    }
    return chords;
  }, [overrides]);
}

function chordTrailing(chord: ShortcutKey[][] | null): ReactElement | null {
  return chord ? <Shortcut chord={chord} /> : null;
}

function ArrangeMenuTriggerIcon() {
  return (
    <ThemedLayoutGrid
      size={iconButtonChromeGlyphSize("large")}
      uniProps={extraMutedIconColorMapping}
    />
  );
}

function arrangeTriggerStyle({
  hovered,
  pressed,
  open,
}: {
  hovered: boolean;
  pressed: boolean;
  open: boolean;
}) {
  return iconButtonChromeStyle({ size: "large", state: { hovered, pressed, open } });
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

/** While the menu is open, bare 1/2/3/G/W/R/E act on it (web and desktop only). */
function useArrangeMenuHotkeys(input: {
  open: boolean;
  onCommand: (command: ArrangeCommand) => void;
}): void {
  const { open, onCommand } = input;
  useEffect(() => {
    if (!open || !isWeb || typeof window === "undefined") {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) {
        return;
      }
      const command = resolveArrangeMenuKey(event);
      if (!command) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCommand(command);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onCommand]);
}

/** Fork mod #13 (Boards): the same split picker as Ctrl+Cmd+O. */
function SplitWorkspacesItem() {
  const { t } = useTranslation();
  const chord = useShortcutKeys("workspace-board-split");
  // The menu closes on select; let it finish before the dialog opens over it.
  const handleSplit = useCallback(() => {
    requestAnimationFrame(openSplitPicker);
  }, []);
  return (
    <DropdownMenuItem
      testID="arrange-menu-split-workspaces"
      leading={SPLIT_WORKSPACES_ICON}
      trailing={chordTrailing(chord)}
      onSelect={handleSplit}
    >
      {t("boards.menu.splitWith")}
    </DropdownMenuItem>
  );
}

function SelectionLine({ workspaceKey }: { workspaceKey: string }) {
  const { t } = useTranslation();
  const selection = useArrangeSelection(workspaceKey);
  const count = selection.tabIds.length + selection.agentIds.length;
  const handleClear = useCallback(() => {
    useArrangeSelectionStore.getState().clear(workspaceKey);
  }, [workspaceKey]);
  if (count === 0) {
    return null;
  }
  return (
    <>
      <View style={styles.selectionLine} testID="arrange-menu-selection">
        <Text style={styles.selectionText} numberOfLines={1}>
          {t("workspace.arrange.selectedCount", { count })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.arrange.clearSelection")}
          onPress={handleClear}
          testID="arrange-menu-clear-selection"
        >
          <Text style={styles.selectionClear}>{t("workspace.arrange.clearSelection")}</Text>
        </Pressable>
      </View>
      <DropdownMenuSeparator />
    </>
  );
}

function SavedLayoutRow({
  layout,
  workspaceKey,
}: {
  layout: NamedLayoutSummary;
  workspaceKey: string;
}) {
  const { t } = useTranslation();
  const handleApply = useCallback(() => {
    applyNamedLayout(workspaceKey, layout.id);
  }, [layout.id, workspaceKey]);
  const handleDelete = useCallback(() => {
    deleteNamedLayout(workspaceKey, layout.id);
  }, [layout.id, workspaceKey]);
  return (
    <View style={styles.savedRow}>
      <View style={styles.savedRowMain}>
        <DropdownMenuItem testID={`arrange-menu-layout-${layout.id}`} onSelect={handleApply}>
          {layout.name}
        </DropdownMenuItem>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("workspace.arrange.deleteLayout")}
        onPress={handleDelete}
        style={styles.deleteButton}
        testID={`arrange-menu-delete-layout-${layout.id}`}
      >
        <ThemedTrash2 size={ICON_SIZE} uniProps={mutedIconColorMapping} />
      </Pressable>
    </View>
  );
}

function SaveLayoutForm({ workspaceKey, onSaved }: { workspaceKey: string; onSaved: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const handleCancel = useCallback(() => setSaving(false), []);
  const handleStart = useCallback(() => setSaving(true), []);
  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    saveNamedLayout(workspaceKey, trimmed);
    setName("");
    setSaving(false);
    onSaved();
  }, [name, onSaved, workspaceKey]);

  if (!saving) {
    return (
      <DropdownMenuItem
        testID="arrange-menu-save"
        leading={SAVE_ICON}
        closeOnSelect={false}
        onSelect={handleStart}
      >
        {t("workspace.arrange.saveCurrent")}
      </DropdownMenuItem>
    );
  }
  return (
    <>
      <MenuTextField
        onChangeText={setName}
        placeholder={t("workspace.arrange.namePlaceholder")}
        autoFocus
        onSubmitEditing={handleSave}
        testID="arrange-menu-layout-name"
      />
      <DropdownMenuItem
        testID="arrange-menu-save-confirm"
        disabled={name.trim().length === 0}
        closeOnSelect={false}
        onSelect={handleSave}
      >
        {t("workspace.arrange.save")}
      </DropdownMenuItem>
      <DropdownMenuItem
        testID="arrange-menu-save-cancel"
        closeOnSelect={false}
        onSelect={handleCancel}
      >
        {t("workspace.arrange.cancel")}
      </DropdownMenuItem>
    </>
  );
}

interface ArrangeMenuProps {
  workspaceKey: string;
  /** Read at the moment a layout is applied, so it is never stale. */
  getViewport: () => ArrangeViewport;
}

/**
 * The header's Arrange button and its menu. Ctrl+Cmd+L opens the same menu (see menu-store.ts);
 * while it is open the keys 1/2/3/G/W/R/E act on it. Every action is a visible row or icon.
 */
export function ArrangeMenu({ workspaceKey, getViewport }: ArrangeMenuProps): ReactElement {
  const { t } = useTranslation();
  const open = useArrangeMenuOpen(workspaceKey);
  const chords = useArrangeShortcutChords();
  const canRestore = useCanRestoreArrangement(workspaceKey);
  const watchOn = useWatchModeActive(workspaceKey);
  const layouts = useNamedLayouts(workspaceKey);

  const setOpen = useCallback(
    (next: boolean) => useArrangeMenuStore.getState().setOpen(workspaceKey, next),
    [workspaceKey],
  );
  const run = useCallback(
    (command: ArrangeCommand) => {
      runArrangeCommand(command, { workspaceKey, viewport: getViewport() });
    },
    [getViewport, workspaceKey],
  );
  const runAndClose = useCallback(
    (command: ArrangeCommand) => {
      run(command);
      setOpen(false);
    },
    [run, setOpen],
  );
  const handleSaved = useCallback(() => setOpen(false), [setOpen]);
  useArrangeMenuHotkeys({ open, onCommand: runAndClose });

  const handleOnePane = useCallback(() => run("single"), [run]);
  const handleColumns2 = useCallback(() => run("columns2"), [run]);
  const handleColumns3 = useCallback(() => run("columns3"), [run]);
  const handleGrid = useCallback(() => run("grid"), [run]);
  const handleWatch = useCallback(() => run("watch"), [run]);
  const handleRestore = useCallback(() => run("restore"), [run]);
  const handleEqualize = useCallback(() => run("equalize"), [run]);

  const watchTrailing = useMemo(
    () => (
      <View style={styles.watchTrailing}>
        {watchOn ? <Text style={styles.watchOn}>{t("workspace.arrange.watchOn")}</Text> : null}
        {chordTrailing(chords.watch)}
      </View>
    ),
    [chords.watch, t, watchOn],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        testID="workspace-header-arrange-trigger"
        style={arrangeTriggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.arrange.button")}
      >
        <ArrangeMenuTriggerIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={280} testID="workspace-header-arrange-menu">
        <SelectionLine workspaceKey={workspaceKey} />
        <DropdownMenuItem
          testID="arrange-menu-single"
          leading={ONE_PANE_ICON}
          trailing={chordTrailing(chords.single)}
          onSelect={handleOnePane}
        >
          {t("workspace.arrange.onePane")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="arrange-menu-columns2"
          leading={COLUMNS_2_ICON}
          trailing={chordTrailing(chords.columns2)}
          onSelect={handleColumns2}
        >
          {t("workspace.arrange.columns2")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="arrange-menu-columns3"
          leading={COLUMNS_3_ICON}
          trailing={chordTrailing(chords.columns3)}
          onSelect={handleColumns3}
        >
          {t("workspace.arrange.columns3")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="arrange-menu-grid"
          leading={GRID_ICON}
          trailing={chordTrailing(chords.grid)}
          onSelect={handleGrid}
        >
          {t("workspace.arrange.grid")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="arrange-menu-watch"
          leading={WATCH_ICON}
          trailing={watchTrailing}
          active={watchOn}
          onSelect={handleWatch}
        >
          {t("workspace.arrange.watch")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="arrange-menu-restore"
          leading={RESTORE_ICON}
          trailing={chordTrailing(chords.restore)}
          disabled={!canRestore}
          onSelect={handleRestore}
        >
          {t("workspace.arrange.restore")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="arrange-menu-equalize"
          leading={EQUALIZE_ICON}
          trailing={chordTrailing(chords.equalize)}
          onSelect={handleEqualize}
        >
          {t("workspace.arrange.equalize")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {layouts.length > 0 ? (
          <>
            <DropdownMenuLabel>{t("workspace.arrange.savedLayouts")}</DropdownMenuLabel>
            {layouts.map((layout) => (
              <SavedLayoutRow key={layout.id} layout={layout} workspaceKey={workspaceKey} />
            ))}
          </>
        ) : null}
        <SaveLayoutForm workspaceKey={workspaceKey} onSaved={handleSaved} />
        <DropdownMenuSeparator />
        <SplitWorkspacesItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  selectionLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: menuRowContentInset(theme),
    paddingVertical: theme.spacing[2],
  },
  selectionText: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  selectionClear: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  savedRowMain: {
    flex: 1,
    minWidth: 0,
  },
  deleteButton: {
    width: 28,
    height: 28,
    marginRight: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  watchTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  watchOn: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
