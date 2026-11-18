import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHomeFetcher, requestHomeRefetch, resetHomeRefetchForTests } from "./refetch";

describe("requestHomeRefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetHomeRefetchForTests();
  });
  afterEach(() => {
    resetHomeRefetchForTests();
    vi.useRealTimers();
  });

  it("asks every registered host once, after a second", () => {
    const one = vi.fn();
    const two = vi.fn();
    registerHomeFetcher("s1", one);
    registerHomeFetcher("s2", two);
    requestHomeRefetch();
    vi.advanceTimersByTime(999);
    expect(one).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
  });

  it("debounces: several closes in a row make one fetch", () => {
    const fetchNow = vi.fn();
    registerHomeFetcher("s1", fetchNow);
    requestHomeRefetch();
    vi.advanceTimersByTime(600);
    requestHomeRefetch();
    vi.advanceTimersByTime(600);
    requestHomeRefetch();
    vi.advanceTimersByTime(1000);
    expect(fetchNow).toHaveBeenCalledTimes(1);
  });

  it("a host that unregistered is not asked", () => {
    const fetchNow = vi.fn();
    const unregister = registerHomeFetcher("s1", fetchNow);
    unregister();
    requestHomeRefetch();
    vi.advanceTimersByTime(1000);
    expect(fetchNow).not.toHaveBeenCalled();
  });
});
