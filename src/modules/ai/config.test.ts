import { describe, expect, it } from "vitest";
import {
  compatModelIdForEndpoint,
  endpointIdFromCompatModel,
  estimateCost,
  getModelContextLimit,
  isCompatModelId,
  migrateLegacyCompatEndpoint,
  modelKeepsReasoning,
  modelSupportsTemperature,
  modelUsesReasoningTokens,
  MODELS,
  MODEL_CONTEXT_LIMITS,
  MODEL_PRICING,
  resolveModel,
  type CustomEndpoint,
} from "./config";

const endpoint: CustomEndpoint = {
  id: "ab12cd34",
  name: "My LLM",
  baseURL: "https://api.example.com/v1",
  modelId: "llama-3.3-70b",
  contextLimit: 64_000,
};

describe("compat model id helpers", () => {
  it("round-trips endpoint id through the synthetic model id", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(isCompatModelId(mid)).toBe(true);
    expect(endpointIdFromCompatModel(mid)).toBe(endpoint.id);
  });

  it("treats static model ids as non-compat", () => {
    expect(isCompatModelId("gpt-5.4-mini")).toBe(false);
    expect(endpointIdFromCompatModel("gpt-5.4-mini")).toBe("");
  });
});

describe("resolveModel", () => {
  it("resolves a compat model id against its endpoint", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    const info = resolveModel(mid, [endpoint]);
    expect(info.provider).toBe("openai-compatible");
    expect(info.id).toBe(mid);
    expect(info.label).toBe(endpoint.modelId);
  });

  it("falls back to a placeholder when the endpoint is gone", () => {
    const info = resolveModel(compatModelIdForEndpoint("missing"), []);
    expect(info.provider).toBe("openai-compatible");
  });



  it("falls back to a placeholder for unknown or empty ids", () => {
    // No catalog exists anymore; a stale or empty selection must render,
    // never throw (a throw here blanks the whole UI on boot).
    expect(resolveModel("nope-not-real").provider).toBe("openai-compatible");
    expect(resolveModel("").provider).toBe("openai-compatible");
  });
});

describe("getModelContextLimit", () => {
  it("uses the per-endpoint override for compat models", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(getModelContextLimit(mid, endpoint.contextLimit)).toBe(64_000);
  });

  it("falls back to a conservative default without an override", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(getModelContextLimit(mid)).toBeLessThanOrEqual(128_000);
  });
});


describe("modelKeepsReasoning", () => {
  it("keeps reasoning for compat endpoints (freeform provider)", () => {
    const info = resolveModel(compatModelIdForEndpoint(endpoint.id), [endpoint]);
    expect(modelKeepsReasoning(info)).toBe(true);
  });
});

describe("model sampling capabilities", () => {
  // No built-in catalog: endpoint models default to temperature support.
  it("defaults endpoint models to temperature support", () => {
    expect(modelSupportsTemperature("openai-compatible", "custom-model")).toBe(
      true,
    );
  });

  it("still flags gpt-oss ids as reasoning models", () => {
    expect(modelUsesReasoningTokens("openai-compatible", "gpt-oss-20b")).toBe(
      true,
    );
    expect(modelUsesReasoningTokens("openai-compatible", "plain-model")).toBe(
      false,
    );
  });
});

describe("migrateLegacyCompatEndpoint", () => {
  it("migrates a fully configured legacy endpoint", () => {
    const out = migrateLegacyCompatEndpoint(
      "https://api.example.com/v1",
      "llama-3.3-70b",
      32_000,
      "fixedid1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "fixedid1",
      baseURL: "https://api.example.com/v1",
      modelId: "llama-3.3-70b",
      contextLimit: 32_000,
    });
  });

  it("skips migration when base URL or model id is missing", () => {
    expect(migrateLegacyCompatEndpoint("", "m", 1, "x")).toEqual([]);
    expect(migrateLegacyCompatEndpoint("u", "  ", 1, "x")).toEqual([]);
  });
});

describe("model catalog invariants", () => {
  const allIds: string[] = MODELS.map((m) => m.id);

  it("keeps the catalog and derived tables empty", () => {
    expect(allIds).toEqual([]);
    expect(Object.keys(MODEL_CONTEXT_LIMITS)).toEqual([]);
    expect(Object.keys(MODEL_PRICING)).toEqual([]);
  });
});

describe("estimateCost", () => {
  const usage = {
    inputTokens: 2_000_000,
    outputTokens: 1_000_000,
    cachedInputTokens: 500_000,
  };

  it("returns null without a model id or a priced model", () => {
    expect(estimateCost(undefined, usage)).toBeNull();
    expect(
      estimateCost("unknown-model", {
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
      }),
    ).toBeNull();
  });

  it("returns null for unpriced endpoint models (no catalog)", () => {
    expect(estimateCost("gpt-5.6", usage)).toBeNull();
    expect(estimateCost("any-custom-model", usage)).toBeNull();
  });
});
