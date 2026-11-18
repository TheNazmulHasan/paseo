import { useEffect, useRef } from "react";
import { isWeb } from "@/constants/platform";
import { decideHomeKey, type HomeKeyAction, type HomeKeyInput } from "./keys";

/** What the keys need to know, read at the moment of the key press. */
export type HomeKeyContext = Omit<
  HomeKeyInput,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "editing" | "onControl"
>;

function isEditable(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function isControl(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  const role = target.getAttribute("role");
  return (
    target.tagName === "BUTTON" ||
    target.tagName === "A" ||
    role === "button" ||
    role === "menuitem"
  );
}

/**
 * Home's keyboard (web and desktop only): 1-9 focus a queue item, Enter opens it, L opens its
 * Later menu, C closes it; in Sweep K keeps, C closes, Enter opens; Esc leaves a Sweep or the
 * Chief drawer. What each key does is decided by `decideHomeKey`; this is only the listener.
 */
export function useHomeKeys(
  getContext: () => HomeKeyContext,
  onAction: (action: HomeKeyAction) => void,
): void {
  const latest = useRef({ getContext, onAction });
  latest.current = { getContext, onAction };

  useEffect(() => {
    if (!isWeb || typeof window === "undefined") return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = decideHomeKey({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        editing: isEditable(event.target),
        onControl: isControl(event.target),
        ...latest.current.getContext(),
      });
      if (!action) return;
      event.preventDefault();
      latest.current.onAction(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
