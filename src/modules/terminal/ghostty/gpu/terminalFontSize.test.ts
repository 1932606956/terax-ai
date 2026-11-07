import { describe, expect, it } from "vitest";
import { terminalFontPixelSize } from "./terminalVisuals";

describe("terminalFontPixelSize", () => {
  it("keeps the same size when UI zoom changes from 1 to 2", () => {
    const fontSize = 14;
    const atZoom1 = terminalFontPixelSize(fontSize);
    const atZoom2 = terminalFontPixelSize(fontSize);
    expect(atZoom1).toBe(14);
    expect(atZoom2).toBe(atZoom1);
    expect(atZoom2).not.toBe(Math.round(fontSize * 2));
  });

  it("still changes when the terminal font size changes", () => {
    expect(terminalFontPixelSize(18)).toBe(18);
    expect(terminalFontPixelSize(18)).not.toBe(terminalFontPixelSize(14));
  });

  it("rounds to a whole pixel and keeps a readable minimum", () => {
    expect(terminalFontPixelSize(13.4)).toBe(13);
    expect(terminalFontPixelSize(13.6)).toBe(14);
    expect(terminalFontPixelSize(1)).toBe(4);
  });
});
