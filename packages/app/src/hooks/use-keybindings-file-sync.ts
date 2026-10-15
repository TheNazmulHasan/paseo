import { useEffect } from "react";
import { getDesktopHost } from "@/desktop/host";
import { buildDefaultsDump } from "@/keyboard/file-keybindings";
import { useKeybindingsFileStore } from "@/stores/keybindings-file-store";
import { resolveAppVersion } from "@/utils/app-version";

/**
 * Desktop only: mirrors ~/.paseo/keybindings.json into the keybindings file
 * store (initial read + live pushes from the main process's file watcher) and
 * refreshes the keybindings.defaults.json reference dump. Mount once.
 */
export function useKeybindingsFileSync(): void {
  useEffect(() => {
    const bridge = getDesktopHost()?.keybindings;
    if (!bridge) return;
    const { applyRawEntries } = useKeybindingsFileStore.getState();
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void Promise.resolve(bridge.get?.())
      .then((payload) => {
        if (!cancelled && payload) applyRawEntries(payload.entries);
        return undefined;
      })
      .catch((error) => console.warn("[Keybindings] could not read keybindings.json", error));

    void Promise.resolve(
      getDesktopHost()?.events?.on?.("keybindings-changed", (payload: unknown) => {
        const entries =
          typeof payload === "object" && payload !== null
            ? (payload as { entries?: unknown }).entries
            : undefined;
        applyRawEntries(entries);
      }),
    ).then((fn) => {
      if (typeof fn !== "function") return undefined;
      if (cancelled) fn();
      else unlisten = fn;
      return undefined;
    });

    void Promise.resolve(bridge.writeDefaults?.(buildDefaultsDump(resolveAppVersion()))).catch(
      (error) => console.warn("[Keybindings] could not write keybindings.defaults.json", error),
    );

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
