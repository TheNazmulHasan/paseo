import { getIsElectronRuntime, useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";

interface KeyboardShortcutEnvironment {
  isNative: boolean;
  isCompact: boolean;
  /** Running inside the Electron desktop shell, where a keyboard always exists. */
  isDesktop?: boolean;
}

/**
 * Compact means "narrow", not "no keyboard".
 *
 * A desktop window deliberately squeezed to a quarter of the screen — Paseo beside
 * another app — falls under the `sm` breakpoint (< 720pt) exactly like a phone does,
 * and switching every shortcut off there disabled the whole keyboard in the layout
 * where reaching a chat by hand is hardest. In the desktop shell there is always a
 * keyboard, whatever the window width, so width alone must not decide this.
 *
 * Width still decides it for the web build, where compact really can mean a phone.
 */
export function keyboardShortcutsAvailable({
  isNative: native,
  isCompact,
  isDesktop = false,
}: KeyboardShortcutEnvironment): boolean {
  if (native) {
    return false;
  }
  if (isDesktop) {
    return true;
  }
  return !isCompact;
}

export function useKeyboardShortcutsAvailable(): boolean {
  const isCompact = useIsCompactFormFactor();
  return keyboardShortcutsAvailable({
    isNative,
    isCompact,
    isDesktop: getIsElectronRuntime(),
  });
}
