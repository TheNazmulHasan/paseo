import { describe, expect, it } from "vitest";
import { advanceSweep, resolveSweep, startSweep } from "./sweep";

describe("Sweep", () => {
  const ids = ["a", "b", "c", "d"];
  const all = new Set(ids);

  it("starts on the first session: 1 of N", () => {
    const position = resolveSweep(startSweep(ids), all);
    expect(position.currentId).toBe("a");
    expect(position.position).toBe(1);
    expect(position.total).toBe(4);
  });

  it("advances one session at a time", () => {
    let state = startSweep(ids);
    state = advanceSweep(resolveSweep(state, all).state);
    expect(resolveSweep(state, all)).toMatchObject({ currentId: "b", position: 2 });
    state = advanceSweep(resolveSweep(state, all).state);
    expect(resolveSweep(state, all)).toMatchObject({ currentId: "c", position: 3 });
  });

  it("skips sessions that went away meanwhile (closed elsewhere)", () => {
    const present = new Set(["a", "c", "d"]);
    let state = startSweep(ids);
    state = advanceSweep(resolveSweep(state, present).state);
    const position = resolveSweep(state, present);
    expect(position.currentId).toBe("c");
    expect(position.position).toBe(3);
  });

  it("skips a gone session at the very start", () => {
    expect(resolveSweep(startSweep(ids), new Set(["b", "c"])).currentId).toBe("b");
  });

  it("finishes with no current session and stays finished", () => {
    let state = startSweep(["a"]);
    state = advanceSweep(resolveSweep(state, all).state);
    const done = resolveSweep(state, all);
    expect(done.currentId).toBeNull();
    expect(done.total).toBe(1);
    expect(advanceSweep(done.state).index).toBe(1);
  });

  it("an empty list is finished at once", () => {
    expect(resolveSweep(startSweep([]), new Set()).currentId).toBeNull();
  });

  it("the list is frozen: new sessions that appear later are not added", () => {
    const state = startSweep(["a", "b"]);
    const position = resolveSweep(state, new Set(["a", "b", "new"]));
    expect(position.total).toBe(2);
  });
});
