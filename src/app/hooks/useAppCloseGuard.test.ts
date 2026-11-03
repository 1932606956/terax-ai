import { describe, expect, it } from "vitest";
import {
  CLOSE_FLUSH_TIMEOUT_MS,
  canOptOutOfAppClosePrompt,
  closeAfterFlush,
} from "./useAppCloseGuard";

describe("canOptOutOfAppClosePrompt", () => {
  it("offers the opt-out when a running process is the only blocker", () => {
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 0, busyTerminal: true }),
    ).toBe(true);
  });

  it("withholds the opt-out whenever unsaved changes are also at stake", () => {
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 1, busyTerminal: true }),
    ).toBe(false);
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 2, busyTerminal: false }),
    ).toBe(false);
  });
});

describe("closeAfterFlush", () => {
  it("closes straight away when chat history was saved", () => {
    expect(closeAfterFlush({ ok: true, failed: [] }, false)).toBe("close");
  });

  it("warns once when conversations failed to write", () => {
    expect(closeAfterFlush({ ok: false, failed: ["s-1"] }, false)).toBe("warn");
  });

  it("never traps the user: after the warning every close request closes", () => {
    expect(closeAfterFlush({ ok: false, failed: ["s-1"] }, true)).toBe("close");
  });

  it("does not block on a drain timeout when nothing failed to write", () => {
    // Data is on disk; a metadata hiccup must not trap the exit.
    expect(closeAfterFlush({ ok: false, failed: [] }, false)).toBe("close");
  });

  it("bounds how long closing waits for the disk", () => {
    expect(CLOSE_FLUSH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CLOSE_FLUSH_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });
});
