import { describe, expect, it } from "vitest";
import { parseModelsPayload } from "./modelList";

describe("parseModelsPayload", () => {
  it("extracts, trims, dedupes and sorts OpenAI-style model ids", () => {
    const models = parseModelsPayload({
      data: [
        { id: " qwen3-max " },
        { id: "glm-4.6" },
        { id: "qwen3-max" },
        { id: 42 },
        {},
        null,
        "not-an-entry",
      ],
    });
    expect(models.map((m) => m.id)).toEqual(["glm-4.6", "qwen3-max"]);
  });

  it("returns empty for malformed payloads instead of throwing", () => {
    expect(parseModelsPayload(null)).toEqual([]);
    expect(parseModelsPayload({})).toEqual([]);
    expect(parseModelsPayload({ data: "nope" })).toEqual([]);
    expect(parseModelsPayload({ data: [{ id: "" }] })).toEqual([]);
  });

  it("caps the list to keep a hostile server from flooding the UI", () => {
    const flood = {
      data: Array.from({ length: 2_000 }, (_, i) => ({ id: `m-${i}` })),
    };
    expect(parseModelsPayload(flood)).toHaveLength(500);
  });
});
