import { describe, expect, it } from "vitest";
import { dragWidthPct } from "./PeekTabs";

describe("dragWidthPct", () => {
  // Row 1000px wide starting at x=0: the card's right edge is the boundary.
  it("grows the card when the pointer moves right", () => {
    const narrow = dragWidthPct(300, 0, 1000) ?? 0;
    const wide = dragWidthPct(600, 0, 1000) ?? 0;
    expect(narrow).toBe(30);
    expect(wide).toBe(60);
    expect(wide).toBeGreaterThan(narrow);
  });

  it("clamps to the 20-75% band", () => {
    expect(dragWidthPct(100, 0, 1000)).toBe(20);
    expect(dragWidthPct(900, 0, 1000)).toBe(75);
  });

  it("is anchored to the row's left edge, not its right edge", () => {
    // A 1200px row starting at x=200: pointer at 800 is 50% of the row.
    expect(dragWidthPct(800, 200, 1200)).toBe(50);
  });

  it("returns null for a degenerate row", () => {
    expect(dragWidthPct(400, 0, 0)).toBeNull();
  });
});
