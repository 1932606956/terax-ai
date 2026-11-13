import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import {
  TeraxGhostty,
  type TeraxGhosttyTerminal,
} from "@terax/ghostty-core/adapted";
import { beforeAll, describe, expect, it } from "vitest";

const CELL = 10;
const COLS = 8;
const ROWS = 6;

function encode(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function directImage(
  id: number,
  format: 24 | 32,
  width: number,
  height: number,
  pixels: Uint8Array,
  extra = "",
): string {
  return `\x1b_Ga=T,t=d,f=${format},i=${id},q=2,s=${width},v=${height}${extra};${encode(pixels)}\x1b\\`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(data, 8);
  const hashed = new Uint8Array(4 + data.length);
  hashed.set(result.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc32(hashed));
  return result;
}

function png(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const row = width * 4;
  const raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (row + 1)] = 0;
    raw.set(rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", header),
    ...chunk("IDAT", deflateSync(raw)),
    ...chunk("IEND", new Uint8Array()),
  ]);
}

function pixel(
  image: { data: Uint8Array; width: number },
  x: number,
  y: number,
): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.subarray(offset, offset + 4)];
}

describe("Kitty graphics WASM", () => {
  let ghostty: TeraxGhostty;

  beforeAll(async () => {
    const path = new URL(
      "../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
      import.meta.url,
    );
    const file = await readFile(path);
    ghostty = await TeraxGhostty.loadBytes(Uint8Array.from(file).buffer);
  });

  function open(): TeraxGhosttyTerminal {
    const terminal = ghostty.createTerminal(COLS, ROWS, {
      maxScrollbackLines: 100,
    });
    terminal.setPixelSize(COLS * CELL, ROWS * CELL);
    return terminal;
  }

  it("transmits raw RGB and RGBA and decodes direct PNG to RGBA", () => {
    const terminal = open();
    try {
      const rgb = Uint8Array.from([10, 20, 30, 40, 50, 60]);
      const rgba = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
      const encoded = png(2, 1, Uint8Array.from([9, 8, 7, 255, 6, 5, 4, 128]));
      terminal.write(
        new TextEncoder().encode(
          directImage(1, 24, 2, 1, rgb) +
            directImage(2, 32, 2, 1, rgba) +
            `\x1b_Ga=T,t=d,f=100,i=3;${encode(encoded)}\x1b\\`,
        ),
      );
      terminal.updateRenderState();
      const placements = terminal.kittyPlacements();
      expect(placements.map((placement) => placement.image.id)).toEqual([
        1, 2, 3,
      ]);
      expect(placements[0].image).toMatchObject({
        format: 3,
        width: 2,
        height: 1,
        generation: expect.any(Number),
      });
      expect([...placements[0].image.data]).toEqual([...rgb]);
      expect(placements[1].image.format).toBe(4);
      expect([...placements[1].image.data]).toEqual([...rgba]);
      expect(placements[2].image).toMatchObject({
        format: 4,
        width: 2,
        height: 1,
      });
      expect(pixel(placements[2].image, 0, 0)).toEqual([9, 8, 7, 255]);
      expect(pixel(placements[2].image, 1, 0)).toEqual([6, 5, 4, 128]);
      expect(placements[0].x).toBe(0);
      expect(placements[0].y).toBe(0);
      expect(placements[0].width).toBe(2);
      expect(placements[0].height).toBe(1);
    } finally {
      terminal.dispose();
    }
  });

  it("reports a source crop and a placement that starts above the viewport", () => {
    const terminal = open();
    try {
      const pixels = new Uint8Array(4 * 4 * 3);
      for (let index = 0; index < pixels.length; index += 1)
        pixels[index] = index;
      terminal.write(
        new TextEncoder().encode(
          `\x1b[3;2H${directImage(7, 24, 4, 4, pixels, ",x=1,y=1,w=2,h=2,c=2,r=3,X=3,Y=4")}`,
        ),
      );
      terminal.write(new TextEncoder().encode("\x1b[6;1H\r\n\r\n\r\n"));
      terminal.updateRenderState();
      const [placement] = terminal.kittyPlacements();
      expect(placement).toMatchObject({
        x: CELL + 3,
        y: -CELL + 4,
        width: 2 * CELL - 3,
        height: 3 * CELL - 4,
        sourceX: 1,
        sourceY: 1,
        sourceWidth: 2,
        sourceHeight: 2,
        z: 0,
      });
      expect(placement.image.data).toBe(
        terminal.kittyPlacements()[0].image.data,
      );
    } finally {
      terminal.dispose();
    }
  });

  it("places Unicode placeholders and placements relative to them", () => {
    const terminal = open();
    try {
      const pixels = Uint8Array.from([
        255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 8, 7,
      ]);
      const placeholder = "\u{10EEEE}";
      terminal.write(
        new TextEncoder().encode(
          `\x1b_Ga=T,t=d,f=24,i=4,s=2,v=2,U=1,p=1,c=2,r=2,q=2;${encode(pixels)}\x1b\\` +
            `\x1b[H\x1b[38:2:0:0:4m${placeholder}\u0305\u0305${placeholder}\u0305\u030d\x1b[39m` +
            `\x1b_Ga=p,i=4,p=2,P=4,Q=1,H=1,V=1,q=2\x1b\\`,
        ),
      );
      terminal.updateRenderState();
      const placements = terminal.kittyPlacements();
      const virtual = placements.find((placement) => placement.z === -1);
      const relative = placements.find((placement) => placement !== virtual);
      expect(virtual).toMatchObject({
        x: 0,
        y: 0,
        z: -1,
        width: 2 * CELL,
        height: CELL,
      });
      expect(virtual?.sourceWidth).toBeGreaterThan(0);
      expect(relative).toMatchObject({
        x: CELL,
        y: CELL,
        z: 0,
        width: 2,
        height: 2,
      });
      expect(relative?.image).toBe(virtual?.image);
    } finally {
      terminal.dispose();
    }
  });

  it("changes generation when the same id is replaced and removes deleted images", () => {
    const terminal = open();
    try {
      const first = Uint8Array.from([1, 2, 3]);
      const second = Uint8Array.from([4, 5, 6]);
      terminal.write(new TextEncoder().encode(directImage(9, 24, 1, 1, first)));
      terminal.updateRenderState();
      const original = terminal.kittyPlacements()[0].image.generation;
      terminal.write(
        new TextEncoder().encode(directImage(9, 24, 1, 1, second)),
      );
      terminal.updateRenderState();
      const replaced = terminal.kittyPlacements()[0];
      expect(replaced.image.generation).toBeGreaterThan(original);
      expect([...replaced.image.data]).toEqual([...second]);
      terminal.write(new TextEncoder().encode("\x1b_Ga=d,d=i,i=9,q=2\x1b\\"));
      terminal.updateRenderState();
      expect(terminal.kittyPlacements()).toEqual([]);
      expect(terminal.kittyPlacements()).toBe(terminal.kittyPlacements());
    } finally {
      terminal.dispose();
    }
  });

  it("keeps images on the alternate screen out of the primary screen", () => {
    const terminal = open();
    try {
      terminal.write(
        new TextEncoder().encode(
          directImage(3, 24, 1, 1, Uint8Array.from([1, 2, 3])),
        ),
      );
      terminal.updateRenderState();
      const primary = terminal.kittyPlacements()[0].image.generation;
      terminal.write(
        new TextEncoder().encode(
          `\x1b[?1049h${directImage(3, 24, 1, 1, Uint8Array.from([7, 8, 9]))}`,
        ),
      );
      terminal.updateRenderState();
      const alternate = terminal.kittyPlacements()[0].image;
      expect(alternate.generation).not.toBe(primary);
      expect([...alternate.data]).toEqual([7, 8, 9]);
      terminal.write(new TextEncoder().encode("\x1b[?1049l"));
      terminal.updateRenderState();
      expect(terminal.kittyPlacements()[0].image.generation).toBe(primary);
      expect([...terminal.kittyPlacements()[0].image.data]).toEqual([1, 2, 3]);
      terminal.write(new TextEncoder().encode("\x1b[?1049h"));
      terminal.updateRenderState();
      expect(terminal.kittyPlacements()).toEqual([]);
    } finally {
      terminal.dispose();
    }
  });

  it("rejects malformed and oversized image transmissions", () => {
    const terminal = open();
    try {
      const oversized = new Uint8Array(4_000_000);
      terminal.write(
        new TextEncoder().encode(
          "\x1b_Ga=T,t=d,f=24,i=1,s=1,v=1;****\x1b\\" +
            "\x1b_Ga=T,t=d,f=99,i=2,s=1,v=1;AAAA\x1b\\" +
            directImage(3, 24, 1000, 1000, oversized) +
            `\x1b_Ga=T,t=d,f=24,i=4,s=1,v=1;${encode(Uint8Array.from([1, 2, 3]))}\x1b\\`,
        ),
      );
      terminal.updateRenderState();
      const placements = terminal.kittyPlacements();
      expect(placements).toHaveLength(1);
      expect(placements[0].image.id).toBe(4);
      const replies = new TextDecoder().decode(terminal.drainOutputBytes());
      expect(replies).toContain("EINVAL");
      expect(replies).toContain("i=4");
      expect(replies).toContain("OK");
    } finally {
      terminal.dispose();
    }
  });
});
