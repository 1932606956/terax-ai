import { readFile } from "node:fs/promises";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { describe, expect, it } from "vitest";

const encoder = new TextEncoder();
const E = "\x1b";

async function open() {
  const file = await readFile(
    new URL(
      "../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
      import.meta.url,
    ),
  );
  const core = await TeraxGhostty.loadBytes(Uint8Array.from(file).buffer);
  const terminal = core.createTerminal(40, 10, { maxScrollbackLines: 100 });
  terminal.setPixelSize(360, 170);
  return terminal;
}

const cellsWithLink = (state: { cellCount: number; linkIds: Uint32Array }) => {
  const out: number[] = [];
  for (let i = 0; i < state.cellCount; i += 1) {
    if (state.linkIds[i]) out.push(i);
  }
  return out;
};

describe("escape sequences that share one write with an APC", () => {
  it("applies a CSI before an OSC 8 payload in the same chunk", async () => {
    const terminal = await open();
    try {
      terminal.write(
        encoder.encode(`${E}[5;3H${E}]8;;https://one${E}\\k${E}]8;;${E}\\`),
      );
      const state = terminal.updateRenderState();
      expect(cellsWithLink(state)).toEqual([4 * 40 + 2]);
    } finally {
      terminal.dispose();
    }
  });

  it("applies a CSI before a Kitty APC transmission and placement", async () => {
    const terminal = await open();
    try {
      const pixels = new Uint8Array(6 * 5 * 4).fill(255);
      const payload = Buffer.from(pixels).toString("base64");
      terminal.write(
        encoder.encode(
          `${E}[5;3H${E}_Ga=T,t=d,f=32,s=6,v=5,i=7,c=6,r=5;${payload}${E}\\` +
            `${E}[5;3H${E}_Ga=p,i=7,c=6,r=5,U=1${E}\\`,
        ),
      );
      terminal.updateRenderState();
      const placements = terminal.kittyPlacements();
      expect(placements).toHaveLength(1);
      expect([placements[0]?.x, placements[0]?.y]).toEqual([2 * 9, 4 * 17]);
    } finally {
      terminal.dispose();
    }
  });

  it("keeps the APC payload intact when it spans several writes", async () => {
    const terminal = await open();
    try {
      const pixels = new Uint8Array(6 * 5 * 4).fill(255);
      const payload = Buffer.from(pixels).toString("base64");
      const command = `${E}_Ga=T,t=d,f=32,s=6,v=5,i=8,c=6,r=5;${payload}${E}\\`;
      for (let offset = 0; offset < command.length; offset += 9) {
        terminal.write(encoder.encode(command.slice(offset, offset + 9)));
      }
      terminal.updateRenderState();
      expect(terminal.kittyPlacements()).toHaveLength(1);
    } finally {
      terminal.dispose();
    }
  });
});
