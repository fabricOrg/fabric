import { describe, expect, it } from "vitest";
import { appendPage, reseedIfChanged, seedState } from "./use-cursor-page.js";

/**
 * Guards the behaviour that made control-plane tables lie: a staff member removed through the row
 * menu stayed on screen, because the accumulated client rows never noticed that the server had sent
 * a fresh first page.
 */
const alice = { id: "a", name: "Alice" };
const bob = { id: "b", name: "Bob" };
const carol = { id: "c", name: "Carol" };

describe("seedState", () => {
  it("copies the seed so a later append can't mutate the caller's array", () => {
    const seed = [alice];
    const state = seedState(seed, "cursor-1");
    expect(state.items).toEqual([alice]);
    expect(state.items).not.toBe(seed);
    expect(state.cursor).toBe("cursor-1");
  });
});

describe("appendPage", () => {
  it("accumulates onto the end and takes the new cursor", () => {
    const state = appendPage(seedState([alice], "cursor-1"), {
      items: [bob],
      next_cursor: "cursor-2",
    });
    expect(state.items).toEqual([alice, bob]);
    expect(state.cursor).toBe("cursor-2");
  });

  it("marks exhaustion with a null cursor", () => {
    const state = appendPage(seedState([alice], "cursor-1"), {
      items: [bob],
      next_cursor: null,
    });
    expect(state.cursor).toBeNull();
  });

  it("keeps the seed reference so a later refresh is still detectable", () => {
    const seed = [alice];
    const state = appendPage(seedState(seed, "cursor-1"), {
      items: [bob],
      next_cursor: null,
    });
    expect(state.seed).toBe(seed);
  });
});

describe("reseedIfChanged", () => {
  it("returns the SAME object when the seed is unchanged", () => {
    // Identity stability is what stops the render-phase update in the hook from looping.
    const seed = [alice, bob];
    const state = seedState(seed, "cursor-1");
    expect(reseedIfChanged(state, seed, "cursor-1")).toBe(state);
  });

  it("re-seeds when the server sends a different first page", () => {
    // The actual bug: Bob was removed, router.refresh() re-ran the Server Component, and the table
    // kept rendering him.
    const state = seedState([alice, bob], "cursor-1");
    const next = reseedIfChanged(state, [alice], null);
    expect(next).not.toBe(state);
    expect(next.items).toEqual([alice]);
    expect(next.cursor).toBeNull();
  });

  it("discards accumulated pages on re-seed", () => {
    // Those pages were read BEFORE the mutation, so they can still contain the removed row —
    // keeping them would put Carol back on screen after she was deleted.
    const loaded = appendPage(seedState([alice], "cursor-1"), {
      items: [bob, carol],
      next_cursor: "cursor-2",
    });
    expect(loaded.items).toEqual([alice, bob, carol]);

    const next = reseedIfChanged(loaded, [alice], null);
    expect(next.items).toEqual([alice]);
    expect(next.cursor).toBeNull();
  });

  it("re-seeds on a new array even when the contents are equal", () => {
    // Deliberate: comparing by reference, not deep equality. A Server Component makes a new array
    // only when it re-runs, and re-seeding an identical list is harmless — whereas deep-comparing
    // every row on every render would cost more than it saves.
    const state = seedState([alice], "cursor-1");
    const next = reseedIfChanged(state, [{ ...alice }], "cursor-1");
    expect(next).not.toBe(state);
    expect(next.items).toEqual([alice]);
  });
});
