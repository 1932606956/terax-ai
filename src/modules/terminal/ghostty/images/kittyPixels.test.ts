import { describe, expect, it } from "vitest";
import { rgbaPixels } from "./kittyPixels";

const metadata = { id: 1, generation: 1, width: 2, height: 1 };

describe("Kitty image pixel uploads", () => {
  it("keeps RGBA bytes borrowed instead of copying an already decoded PNG", () => {
    const data = Uint8Array.of(255, 0, 0, 128, 0, 0, 255, 255);
    expect(rgbaPixels({ ...metadata, format: 4, data })).toBe(data);
  });

  it("expands RGB and grayscale without losing alpha", () => {
    expect([
      ...rgbaPixels({ ...metadata, format: 3, data: Uint8Array.of(1, 2, 3, 4, 5, 6) }),
    ]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    expect([
      ...rgbaPixels({ ...metadata, format: 2, data: Uint8Array.of(8, 64, 200, 128) }),
    ]).toEqual([8, 8, 8, 64, 200, 200, 200, 128]);
    expect([
      ...rgbaPixels({ ...metadata, format: 1, data: Uint8Array.of(8, 200) }),
    ]).toEqual([8, 8, 8, 255, 200, 200, 200, 255]);
  });

  it("rejects malformed pixel lengths instead of reading into another WASM allocation", () => {
    expect(() => rgbaPixels({ ...metadata, format: 3, data: new Uint8Array(5) })).toThrow(RangeError);
    expect(() => rgbaPixels({ ...metadata, width: 0, format: 4, data: new Uint8Array() })).toThrow(RangeError);
  });
});
