import { beforeEach, describe, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => dialog);

import { resolveNewTabCwd } from "./resolveNewTabCwd";

beforeEach(() => {
  dialog.open.mockReset();
});

describe("resolveNewTabCwd", () => {
  it("returns the picked folder", async () => {
    dialog.open.mockResolvedValueOnce("D:/picked");
    await expect(resolveNewTabCwd("D:/default")).resolves.toBe("D:/picked");
    expect(dialog.open).toHaveBeenCalledWith({
      directory: true,
      defaultPath: "D:/default",
    });
  });

  it("returns null when the dialog is cancelled", async () => {
    dialog.open.mockResolvedValueOnce(null);
    await expect(resolveNewTabCwd("D:/default")).resolves.toBeNull();
  });

  it("omits defaultPath when there is no preferred cwd", async () => {
    dialog.open.mockResolvedValueOnce("D:/picked");
    await expect(resolveNewTabCwd(null)).resolves.toBe("D:/picked");
    expect(dialog.open).toHaveBeenCalledWith({
      directory: true,
      defaultPath: undefined,
    });
  });
});
