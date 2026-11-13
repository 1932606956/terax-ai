import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { AdaptedGhosttyTerminalModel } from "./AdaptedGhosttyTerminalModel";
import { GhosttyBlocks } from "./GhosttyBlocks";
import { GhosttyBlockSession } from "./ghosttyBlockSessions";

vi.mock("@/modules/terminal/ghostty/windowPresentation", () => ({
  subscribeWindowPresentation: (
    listener: (state: { visible: boolean; reclaim: boolean }) => void,
  ) => {
    listener({ visible: true, reclaim: false });
    return () => {};
  },
}));

/**
 * Input routing (who gets a key, who gets a click) is decided by the block
 * session's cached mode, and that cache is refreshed from damage. Damage is
 * deliberately withheld while a prompt is being redrawn, so a TUI that starts
 * inside that window (a shell prompt that never ends, a synchronized update)
 * must still flip the mode: otherwise its keys go to the shell prompt and its
 * mouse reports are never sent.
 */
describe.each(["ghostty-vt", "ghostty-vt-scalar"])(
  "block mode under a held presentation (%s)",
  (artifact) => {
    let core: TeraxGhostty;

    beforeAll(async () => {
      const bytes = await readFile(
        new URL(
          `../../../../packages/ghostty-core/adapted/${artifact}.wasm`,
          import.meta.url,
        ),
      );
      core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
    });

    async function create() {
      let blocks: GhosttyBlocks;
      let frames = 0;
      const model = new AdaptedGhosttyTerminalModel(core, {
        backend: "ghostty-webgpu",
        cols: 40,
        rows: 12,
        onEvent: (event) => blocks.handle(event, "/workspace"),
      });
      blocks = new GhosttyBlocks(model);
      const session = new GhosttyBlockSession();
      await session.attach(model, () => {});
      // Stands in for a renderer: consumes the damage it was told about.
      model.subscribeDamage(() => {
        frames += 1;
        model.consumeGpuFrame();
        session.changed();
      });
      session.setVisible(true);
      session.present();
      return {
        model,
        blocks,
        session,
        frames: () => frames,
        write: (text: string) => model.write(new TextEncoder().encode(text)),
        dispose: () => {
          session.dispose();
          blocks.dispose();
          model.dispose();
        },
      };
    }

    it("follows the alternate screen while a prompt is still open", async () => {
      const h = await create();
      try {
        h.write("\x1b]133;A\x07$ ");
        expect(h.model.presentationSuppressed()).toBe(true);
        h.write("\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h");
        // No frame was presented: the open prompt still owns the screen.
        expect(h.frames()).toBe(0);
        expect(h.model.modes().alternateScreen).toBe(true);
        expect(h.model.modes().mouseTracking).toBe(true);
        expect(h.session.getMode()).toBe("alt");
      } finally {
        h.dispose();
      }
    });

    it("follows a synchronized update that takes the alternate screen", async () => {
      const h = await create();
      try {
        h.write("\x1b]133;A\x07$ \x1b]133;B\x07");
        h.write("\x1b]133;C;dsh-tui\x07");
        h.write("\x1b[?2026h\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h");
        expect(h.model.presentationSuppressed()).toBe(true);
        const before = h.frames();
        expect(h.session.getMode()).toBe("alt");
        expect(h.model.modes().mouseTracking).toBe(true);
        // The held frame is still held; only the fact reached the session.
        expect(h.frames()).toBe(before);
      } finally {
        h.dispose();
      }
    });

    it("leaves the alternate-screen mode when the program exits", async () => {
      const h = await create();
      try {
        h.write("\x1b]133;A\x07$ \x1b]133;B\x07");
        const shellMode = h.session.getMode();
        h.write("\x1b[?1049h\x1b[?1000h\x1b[?1006h");
        expect(h.session.getMode()).toBe("alt");
        h.write("\x1b[?1006l\x1b[?1000l\x1b[?1049l");
        expect(h.model.modes().alternateScreen).toBe(false);
        expect(h.model.modes().mouseTracking).toBe(false);
        // Back to whatever the shell was: the TUI no longer owns input.
        expect(h.session.getMode()).toBe(shellMode);
      } finally {
        h.dispose();
      }
    });
  },
);
