import { UnistylesRuntime } from "react-native-unistyles";
import { resolveSyntaxColors, type SyntaxThemeId } from "@getpaseo/highlight";
import {
  DEFAULT_UI_FONT_STACK,
  DEFAULT_MONO_FONT_STACK,
  FONT_SIZE,
  REGISTERED_THEMES,
  type Theme,
} from "@/styles/theme";
import { applyRootUiFont } from "./apply-root-font";

const ALL_THEME_KEYS = Object.keys(REGISTERED_THEMES) as (keyof typeof REGISTERED_THEMES)[];

export interface AppearanceInput {
  uiFontFamily: string; // "" -> default stack
  monoFontFamily: string; // "" -> default stack
  uiBaseFontSize: number; // already clamped
  contentFontSize: number; // already clamped
  codeFontSize: number; // already clamped
  syntaxTheme: SyntaxThemeId;
  contentTextTone: number; // already clamped percent, 100 = full contrast
}

/**
 * Blend a hex colour toward a backdrop. Used to dim chat prose without touching
 * app chrome. Mixing (rather than alpha) keeps the text opaque, so it reads the
 * same over code fences, callouts, and selection highlights.
 * Returns `color` unchanged for any value that is not a 6-digit hex.
 */
export function mixTowardBackdrop(color: string, backdrop: string, tone: number): string {
  const ratio = Math.min(1, Math.max(0, tone / 100));
  if (ratio >= 1) {
    return color;
  }
  const parse = (value: string): [number, number, number] | null => {
    if (typeof value !== "string") {
      return null;
    }
    const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (!match) {
      return null;
    }
    const int = Number.parseInt(match[1], 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  };
  const front = parse(color);
  const back = parse(backdrop);
  if (!front || !back) {
    return color;
  }
  const channel = (index: number) =>
    Math.round(front[index] * ratio + back[index] * (1 - ratio))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/**
 * Build the font-size ramp from the canonical `FONT_SIZE` ramp, scaled
 * proportionally from the requested base size so the type hierarchy is preserved
 * sizes. Deriving from the authored ramp — NOT the live (possibly already-scaled)
 * theme — makes `applyAppearance` idempotent: repeated applies never compound, and a
 * code-size change (base size unchanged) leaves the UI ramp at its authored values.
 * `code` is set absolutely to `codeSize`, never scaled by the UI factor — a separate
 * control on a separate semantic axis (mono/diff text).
 */
function scaleFontSize(
  uiBaseSize: number,
  contentSize: number,
  codeSize: number,
): Theme["fontSize"] {
  const r = uiBaseSize / FONT_SIZE.base;
  return {
    sm: Math.round(FONT_SIZE.sm * r),
    base: Math.round(FONT_SIZE.base * r),
    lg: Math.round(FONT_SIZE.lg * r),
    xl: Math.round(FONT_SIZE.xl * r),
    "2xl": Math.round(FONT_SIZE["2xl"] * r),
    "3xl": Math.round(FONT_SIZE["3xl"] * r),
    "4xl": Math.round(FONT_SIZE["4xl"] * r),
    content: contentSize, // absolute, NOT scaled
    code: codeSize, // absolute, NOT scaled
  };
}

/**
 * Patch every registered Unistyles theme with the user's appearance choices.
 * All keys in `ALL_THEME_KEYS` are patched because the active theme can change
 * and adaptive mode can flip light/dark — patching all keys keeps the active key
 * always current and makes ordering vs `setTheme`/`setAdaptiveThemes` irrelevant.
 *
 * The updater preserves the active theme wholesale (surfaces, accents,
 * terminal) and only patches the font ramp and syntax palette.
 * `updateTheme` replaces the stored theme rather than merging, so we spread
 * `...t` first.
 */
export function applyAppearance(input: AppearanceInput): void {
  const ui = input.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK;
  const mono = input.monoFontFamily.trim() || DEFAULT_MONO_FONT_STACK;
  const diffLineHeight = Math.round(input.codeFontSize * 1.5); // couple to code size
  const activeTheme = UnistylesRuntime.themeName;
  // Unistyles web emits after each registry patch. Updating the mounted theme
  // first ensures subscribers receive its new numeric tokens in this render;
  // updating it last makes Pure black appear one committed value behind.
  const themeKeys = activeTheme
    ? [activeTheme, ...ALL_THEME_KEYS.filter((key) => key !== activeTheme)]
    : ALL_THEME_KEYS;

  for (const key of themeKeys) {
    UnistylesRuntime.updateTheme(key, (t) => {
      const fontFamily = { ui, mono };
      const fontSize = scaleFontSize(
        input.uiBaseFontSize,
        input.contentFontSize,
        input.codeFontSize,
      );
      const lineHeight = { ...t.lineHeight, diff: diffLineHeight };
      // Dim prose toward the workspace surface the chat actually sits on, so the
      // requested tone lands the same in light and dark themes.
      const contentForeground = mixTowardBackdrop(
        t.colors.foreground,
        t.colors.surfaceWorkspace,
        input.contentTextTone,
      );
      if (t.colorScheme === "light") {
        return {
          ...t,
          fontFamily,
          fontSize,
          lineHeight,
          colors: {
            ...t.colors,
            contentForeground,
            syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme),
          },
        };
      }
      return {
        ...t,
        fontFamily,
        fontSize,
        lineHeight,
        colors: {
          ...t.colors,
          contentForeground,
          syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme),
        },
      };
    });
  }

  // Web: apply the UI font app-wide (RN-web stamps a default font on every text
  // element, so it can't be done through the theme alone). No-op on native.
  applyRootUiFont(ui);
}
