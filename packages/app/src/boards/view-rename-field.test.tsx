// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pressable, View } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewRenameField } from "@/boards/view-rename-field";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(ui: React.ReactElement): HTMLInputElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
  const input = container.querySelector("input");
  if (!input) {
    throw new Error("no input rendered");
  }
  return input;
}

function type(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(input: HTMLInputElement, key: string): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function field(onCommit = vi.fn(), onCancel = vi.fn()) {
  return {
    onCommit,
    onCancel,
    ui: (
      <ViewRenameField
        initialValue="A | B"
        placeholder="Name"
        onCommit={onCommit}
        onCancel={onCancel}
      />
    ),
  };
}

describe("ViewRenameField", () => {
  it("Enter saves the typed name", () => {
    const { ui, onCommit, onCancel } = field();
    const input = mount(ui);
    type(input, "Backlog");
    press(input, "Enter");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Backlog");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("clicking away saves the typed name", () => {
    const { ui, onCommit, onCancel } = field();
    const input = mount(ui);
    type(input, "Backlog");
    act(() => {
      input.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Backlog");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Escape cancels", () => {
    const { ui, onCommit, onCancel } = field();
    const input = mount(ui);
    type(input, "Backlog");
    press(input, "Escape");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the parent re-renders with new callbacks", () => {
    const first = field();
    const input = mount(first.ui);
    type(input, "Backlog");
    const second = field();
    act(() => root!.render(second.ui));
    press(input, "Enter");
    expect(second.onCommit).toHaveBeenCalledExactlyOnceWith("Backlog");
    expect(first.onCommit).not.toHaveBeenCalled();
  });

  it("works while sitting inside a pressable row (Enter reaches the box, the row does not press)", () => {
    const onPress = vi.fn();
    const { onCommit, onCancel } = field();
    const input = mount(
      <Pressable accessibilityRole="button" onPress={onPress}>
        <View>
          <ViewRenameField
            initialValue="A | B"
            placeholder="Name"
            onCommit={onCommit}
            onCancel={onCancel}
          />
        </View>
      </Pressable>,
    );
    type(input, "Backlog");
    press(input, "Enter");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Backlog");
    expect(onPress).not.toHaveBeenCalled();
  });
});
