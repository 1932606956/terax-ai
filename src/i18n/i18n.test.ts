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
});
