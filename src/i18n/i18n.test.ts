import { describe, expect, it } from "vitest";
import { dictionary, t } from "./zh";

describe("i18n dictionary", () => {
  it("translates known keys", () => {
    expect(t("settings.general")).toBe("通用");
  });

  it("falls back to the key for unknown entries", () => {
    expect(t("settings.missing")).toBe("settings.missing");
  });

  it("keeps every value a non-empty string", () => {
    for (const [key, value] of Object.entries(dictionary)) {
      expect(key.length).toBeGreaterThan(0);
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("substitutes close-dialog counts", () => {
    expect(t("close.nFiles", "3")).toBe("3 个文件有未保存的更改");
    expect(t("close.quitBusy")).toBe(
      "终端中仍有进程在运行。退出将终止该进程。",
    );
    expect(
      t("close.dirtyAndBusy", { n: "2", m: "4" }),
    ).toContain("2 个标签页");
    expect(t("close.dirtyAndBusy", { n: "2", m: "4" })).toContain(
      "4 个进程",
    );
    expect(t("close.oneDirtyAndBusy", { m: "3" })).not.toContain("{m}");
  });
});
