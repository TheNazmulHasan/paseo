import { useEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import {
  getPlaceSidebars,
  rememberPlaceSidebars,
  resolvePlaceKeyFromPathname,
  resolvePlaceLeftSidebarStep,
  usePlaceSidebarsStore,
} from "@/stores/place-sidebars-store";
import { usePanelStore } from "@/stores/panel-store";

const DESKTOP_LAYOUT = { isCompact: false } as const;

function useStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(
    () => usePlaceSidebarsStore.persist.hasHydrated() && usePanelStore.persist.hasHydrated(),
  );
  useEffect(() => {
    const check = () =>
      setHydrated(
        usePlaceSidebarsStore.persist.hasHydrated() && usePanelStore.persist.hasHydrated(),
      );
    const offA = usePlaceSidebarsStore.persist.onFinishHydration(check);
    const offB = usePanelStore.persist.onFinishHydration(check);
    check();
    return () => {
      offA();
      offB();
    };
  }, []);
  return hydrated;
}

/**
 * Each place (workspace or view) remembers its own left sidebar. Mounted once at app level,
 * desktop only. Arriving at a place applies its stored value (or stores the current one if it
 * has none); while on a place, any change of the sidebar is stored for that place.
 */
export function usePlaceLeftSidebar(enabled: boolean): void {
  const pathname = usePathname();
  const placeKey = resolvePlaceKeyFromPathname(pathname);
  const hydrated = useStoresHydrated();
  // The place the sidebar is currently attributed to. Updated BEFORE applying a stored value,
  // so the apply is recorded for the new place and never for the one being left.
  const currentPlaceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !hydrated) {
      currentPlaceRef.current = null;
      return;
    }
    const previous = currentPlaceRef.current;
    currentPlaceRef.current = placeKey;
    if (!placeKey) return;
    const panel = usePanelStore.getState();
    const step = resolvePlaceLeftSidebarStep({
      placeChanged: previous !== placeKey,
      stored: getPlaceSidebars(placeKey)?.left,
      current: panel.desktop.agentListOpen,
    });
    if (step.type === "apply") {
      if (step.open) panel.openAgentListForLayout(DESKTOP_LAYOUT);
      else panel.closeAgentListForLayout(DESKTOP_LAYOUT);
    } else if (step.type === "remember") {
      rememberPlaceSidebars(placeKey, { left: step.open });
    }
  }, [enabled, hydrated, placeKey]);

  useEffect(() => {
    if (!enabled || !hydrated) return;
    return usePanelStore.subscribe((state, prev) => {
      const key = currentPlaceRef.current;
      if (!key || state.desktop.agentListOpen === prev.desktop.agentListOpen) return;
      rememberPlaceSidebars(key, { left: state.desktop.agentListOpen });
    });
  }, [enabled, hydrated]);
}
