import { createContext, useCallback, useContext, useMemo, useState, type Ref } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { GripVertical } from "lucide-react-native";
import { moveBoardPane } from "@/boards/controller";
import { resolveBoardPaneDropPosition } from "@/boards/screen-helpers";
import {
  SplitDropZone,
  resolveSplitDropPosition,
  type SplitDropZoneHover,
} from "@/components/split-drop-zone";
import { iconButtonChromeStyle, mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { isNative } from "@/constants/platform";

/**
 * Drag a pane by its grip over another pane to move it there. Reuses the primitives the
 * workspace's own tab dragging runs on (dnd-kit's DndContext + the shared SplitDropZone
 * overlay and zone maths), so a view's drop zones look and behave like a workspace's.
 * Escape cancels (dnd-kit's PointerSensor listens for it).
 */

const PANE_DRAG_KIND = "board-pane";
const ThemedGripVertical = withUnistyles(GripVertical);
const GRIP_ICON_SIZE = 14;
const GRIP_STYLE = { cursor: "grab", touchAction: "none" };
const GRIP_STYLE_DRAGGING = { cursor: "grabbing", touchAction: "none" };

interface BoardPaneDragState {
  activePaneId: string | null;
  preview: SplitDropZoneHover | null;
}

const BoardPaneDragContext = createContext<BoardPaneDragState>({
  activePaneId: null,
  preview: null,
});

function readPaneId(data: unknown, kind: string): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const record = data as { kind?: unknown; paneId?: unknown };
  return record.kind === kind && typeof record.paneId === "string" ? record.paneId : null;
}

const dropOnPanesOnly: CollisionDetection = (args) =>
  pointerWithin(args).filter(
    (entry) => entry.data?.droppableContainer.data.current?.kind === "split-pane-drop",
  );

function computePreview(event: Pick<DragMoveEvent, "active" | "over">): SplitDropZoneHover | null {
  const translated = event.active.rect.current.translated;
  const overRect = event.over?.rect;
  const overPaneId = readPaneId(event.over?.data.current, "split-pane-drop");
  if (!translated || !overRect || !overPaneId || overRect.width <= 0 || overRect.height <= 0) {
    return null;
  }
  const x = translated.left + translated.width / 2 - overRect.left;
  const y = translated.top + translated.height / 2 - overRect.top;
  if (x < 0 || x > overRect.width || y < 0 || y > overRect.height) {
    return null;
  }
  return {
    paneId: overPaneId,
    position: resolveSplitDropPosition({ width: overRect.width, height: overRect.height, x, y }),
  };
}

interface BoardPaneDndProviderProps {
  boardId: string;
  /** Text for the chip that follows the pointer while dragging. */
  getPaneLabel: (paneId: string) => string;
  children: React.ReactNode;
}

export function BoardPaneDndProvider({
  boardId,
  getPaneLabel,
  children,
}: BoardPaneDndProviderProps) {
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SplitDropZoneHover | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const reset = useCallback(() => {
    setActivePaneId(null);
    setPreview(null);
  }, []);
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActivePaneId(readPaneId(event.active.data.current, PANE_DRAG_KIND));
  }, []);
  const handleDragMove = useCallback((event: DragMoveEvent | DragOverEvent) => {
    setPreview(computePreview(event));
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const sourcePaneId = readPaneId(event.active.data.current, PANE_DRAG_KIND);
      const drop = event.over ? computePreview(event) : null;
      reset();
      if (sourcePaneId && drop && drop.paneId !== sourcePaneId) {
        moveBoardPane(
          boardId,
          sourcePaneId,
          drop.paneId,
          resolveBoardPaneDropPosition(drop.position),
        );
      }
    },
    [boardId, reset],
  );

  const state = useMemo(() => ({ activePaneId, preview }), [activePaneId, preview]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dropOnPanesOnly}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragMove}
      onDragCancel={reset}
      onDragEnd={handleDragEnd}
    >
      <BoardPaneDragContext value={state}>{children}</BoardPaneDragContext>
      <DragOverlay dropAnimation={null}>
        {activePaneId ? (
          <View style={styles.overlayChip}>
            <Text style={styles.overlayText} numberOfLines={1}>
              {getPaneLabel(activePaneId)}
            </Text>
          </View>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Drop zones (left/right/top/bottom edges, centre = swap) shown over a pane during a drag. */
export function BoardPaneDropOverlay({ paneId }: { paneId: string }) {
  const { activePaneId, preview } = useContext(BoardPaneDragContext);
  return (
    <SplitDropZone
      paneId={paneId}
      active={activePaneId !== null && activePaneId !== paneId}
      preview={preview}
    />
  );
}

/** Always-visible grip in a pane's tab strip. Drag it onto another pane to rearrange. */
export function BoardPaneDragHandle({ paneId, label }: { paneId: string; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `board-pane-drag:${paneId}`,
    data: { kind: PANE_DRAG_KIND, paneId },
  });
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      iconButtonChromeStyle({ size: "small", state: { hovered: Boolean(hovered), pressed } }),
      (isDragging ? GRIP_STYLE_DRAGGING : GRIP_STYLE) as object,
    ],
    [isDragging],
  );
  if (isNative) {
    return null;
  }
  return (
    <Pressable
      ref={setNodeRef as unknown as Ref<View>}
      {...(attributes as object)}
      {...(listeners as object)}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`board-pane-grip-${paneId}`}
    >
      <ThemedGripVertical size={GRIP_ICON_SIZE} uniProps={mutedIconColorMapping} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlayChip: {
    maxWidth: 260,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  overlayText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
