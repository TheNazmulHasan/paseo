import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, FolderInput, FolderPlus, Inbox } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { PressHighlight } from "@/components/ui/press-highlight";
import { isWeb } from "@/constants/platform";
import { moveHighlight } from "@/boards/workspace-picker-model";
import { useFolderIndex } from "@/folders/folder-store";
import { closeFolderPicker, useFolderPickerStore } from "@/folders/folder-picker-store";
import {
  buildFolderPickerOptions,
  folderKeyOfItem,
  formatFolderNameInput,
  type FolderPickerOption,
} from "@/folders/model";
import { useFolderActions } from "@/folders/use-folder-actions";
import type { Theme } from "@/styles/theme";

const ThemedCheck = withUnistyles(Check);
const ThemedFolderInput = withUnistyles(FolderInput);
const ThemedInbox = withUnistyles(Inbox);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const ICON_SIZE = 16;

function isTypingSurface(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return true;
  }
  return target === document.body || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

/** Arrows move the highlight, Enter files the item into the highlighted row. */
function usePickerKeys(input: {
  visible: boolean;
  onMove: (delta: number) => void;
  onConfirm: () => void;
}): void {
  const { visible, onMove, onConfirm } = input;
  useEffect(() => {
    if (!visible || !isWeb || typeof document === "undefined") {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing ||
        !isTypingSurface(event.target)
      ) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        onMove(event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onConfirm, onMove, visible]);
}

function optionLabel(
  option: FolderPickerOption,
  unfiledLabel: string,
  createLabel: string,
): string {
  if (option.kind === "folder") return option.name;
  return option.kind === "unfiled" ? unfiledLabel : createLabel;
}

function OptionLead({ option }: { option: FolderPickerOption }) {
  if (option.kind === "unfiled") {
    return <ThemedInbox size={ICON_SIZE} uniProps={mutedMapping} />;
  }
  if (option.kind === "create") {
    return <ThemedFolderPlus size={ICON_SIZE} uniProps={mutedMapping} />;
  }
  return option.emoji ? (
    <Text style={styles.emoji}>{option.emoji}</Text>
  ) : (
    <ThemedFolderInput size={ICON_SIZE} uniProps={mutedMapping} />
  );
}

const PickerRow = memo(function PickerRow({
  option,
  index,
  highlighted,
  unfiledLabel,
  createLabel,
  onSelect,
  onHover,
}: {
  option: FolderPickerOption;
  index: number;
  highlighted: boolean;
  unfiledLabel: string;
  createLabel: string;
  onSelect: (option: FolderPickerOption) => void;
  onHover: (index: number) => void;
}) {
  const handlePress = useCallback(() => onSelect(option), [onSelect, option]);
  const handleHover = useCallback(() => onHover(index), [index, onHover]);
  const rowStyle = useMemo(() => [styles.row, highlighted && styles.rowHighlighted], [highlighted]);
  const label = optionLabel(option, unfiledLabel, createLabel);
  const current = option.kind !== "create" && option.current;
  return (
    <PressHighlight
      style={rowStyle}
      onPress={handlePress}
      onHoverIn={handleHover}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`folder-picker-row-${option.key}`}
    >
      <View style={styles.lead}>
        <OptionLead option={option} />
      </View>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {label}
      </Text>
      {current ? <ThemedCheck size={14} uniProps={foregroundMapping} /> : null}
    </PressHighlight>
  );
});

/**
 * "Move to folder": type to filter the folders, Enter files the item into the highlighted one; a
 * name nobody has yet shows a "New folder" row, so typing it and pressing Enter makes the folder
 * and files the item there. Unfiled takes the item out of its folder. Opened by Ctrl+Cmd+M, a
 * row's folder icon and the row menus.
 */
export function FolderPicker() {
  const { t } = useTranslation();
  const target = useFolderPickerStore((state) => state.target);
  const openCount = useFolderPickerStore((state) => state.openCount);
  const visible = target !== null;
  const index = useFolderIndex();
  const { moveItem, createAndMove } = useFolderActions();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const currentFolderKey = useMemo(
    () => (target ? folderKeyOfItem(index, target) : null),
    [index, target],
  );
  const unfiledLabel = t("folders.unfiled");
  const options = useMemo(
    () =>
      buildFolderPickerOptions({
        groups: index.groups,
        query,
        currentFolderKey,
        unfiledLabel,
      }),
    [currentFolderKey, index.groups, query, unfiledLabel],
  );
  const safeHighlight = Math.min(highlight, Math.max(options.length - 1, 0));

  useEffect(() => {
    if (visible) {
      setQuery("");
      setHighlight(0);
    }
  }, [visible, openCount]);

  const handleQuery = useCallback((value: string) => {
    setQuery(value);
    setHighlight(0);
  }, []);
  const handleMove = useCallback(
    (delta: number) => setHighlight((current) => moveHighlight(current, delta, options.length)),
    [options.length],
  );
  const select = useCallback(
    (option: FolderPickerOption) => {
      if (!target) return;
      closeFolderPicker();
      if (option.kind === "create") {
        void createAndMove(target, formatFolderNameInput(option));
      } else {
        void moveItem(target, option.kind === "folder" ? option.key : null);
      }
    },
    [createAndMove, moveItem, target],
  );
  const handleConfirm = useCallback(() => {
    const option = options[safeHighlight];
    if (option) select(option);
  }, [options, safeHighlight, select]);
  usePickerKeys({ visible, onMove: handleMove, onConfirm: handleConfirm });

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("folders.picker.title"),
      search: {
        onChange: handleQuery,
        placeholder: t("folders.picker.searchPlaceholder"),
        autoFocus: true,
        resetKey: openCount,
        testID: "folder-picker-search",
      },
    }),
    [handleQuery, openCount, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={closeFolderPicker}
      testID="folder-picker"
    >
      {options.length === 0 ? (
        <Text style={styles.empty} testID="folder-picker-empty">
          {t("folders.picker.empty")}
        </Text>
      ) : (
        options.map((option, position) => (
          <PickerRow
            key={option.key}
            option={option}
            index={position}
            highlighted={position === safeHighlight}
            unfiledLabel={unfiledLabel}
            createLabel={
              option.kind === "create"
                ? t("folders.picker.create", { name: formatFolderNameInput(option) })
                : ""
            }
            onSelect={select}
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
  lead: { width: 22, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 16 },
  rowTitle: { flex: 1, minWidth: 0, fontSize: theme.fontSize.base, color: theme.colors.foreground },
  empty: {
    padding: theme.spacing[3],
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
}));
