import { describe, expect, it } from "vitest";
import { shouldSuppressShortcut } from "./suppression";

describe("shouldSuppressShortcut", () => {
  it("off never suppresses", () => {
    expect(shouldSuppressShortcut("off", false, false)).toBe(false);
    expect(shouldSuppressShortcut("off", false, null)).toBe(false);
    expect(shouldSuppressShortcut("off", true, false)).toBe(false);
    expect(shouldSuppressShortcut("off", true, true)).toBe(false);
    expect(shouldSuppressShortcut("off", true, null)).toBe(false);
  });

  it("always suppresses only inside the terminal", () => {
    expect(shouldSuppressShortcut("always", false, false)).toBe(false);
    expect(shouldSuppressShortcut("always", false, true)).toBe(false);
    expect(shouldSuppressShortcut("always", false, null)).toBe(false);
    expect(shouldSuppressShortcut("always", true, false)).toBe(true);
    expect(shouldSuppressShortcut("always", true, true)).toBe(true);
    expect(shouldSuppressShortcut("always", true, null)).toBe(true);
  });

  it("altScreen suppresses only in terminal on the alternate screen", () => {
    expect(shouldSuppressShortcut("altScreen", false, false)).toBe(false);
    expect(shouldSuppressShortcut("altScreen", false, true)).toBe(false);
    expect(shouldSuppressShortcut("altScreen", false, null)).toBe(false);
    expect(shouldSuppressShortcut("altScreen", true, false)).toBe(false);
    expect(shouldSuppressShortcut("altScreen", true, null)).toBe(false);
    expect(shouldSuppressShortcut("altScreen", true, true)).toBe(true);
  });
});
