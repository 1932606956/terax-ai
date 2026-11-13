import type { TeraxGhosttyKittyImage } from "@terax/ghostty-core/adapted";

/** Converts only when the decoded native format cannot be uploaded as RGBA. */
export function rgbaPixels(image: TeraxGhosttyKittyImage): Uint8Array {
  const { width, height, format, data } = image;
  const count = width * height;
  if (
    !Number.isSafeInteger(count) ||
    width <= 0 ||
    height <= 0 ||
    data.length !== count * format
  ) {
    throw new RangeError("Invalid Kitty image pixel buffer");
  }
  if (format === 4) return data;
  const rgba = new Uint8Array(count * 4);
  for (
    let source = 0, target = 0;
    source < data.length;
    source += format, target += 4
  ) {
    rgba[target] = data[source];
    rgba[target + 1] = format < 3 ? data[source] : data[source + 1];
    rgba[target + 2] = format < 3 ? data[source] : data[source + 2];
    rgba[target + 3] = format === 2 ? data[source + 1] : 255;
  }
  return rgba;
}
