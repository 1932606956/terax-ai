import { generateText, stepCountIs } from "ai";
import {
  type CustomEndpoint,
  endpointIdFromCompatModel,
  isCompatModelId,
} from "../config";
import { buildLanguageModel } from "../lib/agent";
import type { CustomEndpointKeys, ProviderKeys } from "../lib/keyring";
import type { ToolContext } from "../tools/context";
import { buildFsTools } from "../tools/fs";
import { buildSearchTools } from "../tools/search";
import { SUBAGENTS, type SubagentType } from "./registry";

const SUBAGENT_MAX_STEPS = 12;

type Args = {
  type: SubagentType;
  prompt: string;
  keys: ProviderKeys;
  modelId: string;
  toolContext: ToolContext;
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
  onStep?: (label: string) => void;
};

type RunResult = {
  summary: string;
  stepCount: number;
  durationMs: number;
};

export async function runSubagent({
  type,
  prompt,
  keys,
  modelId,
  toolContext,
  customEndpoints = [],
  customEndpointKeys = {},
  onStep,
}: Args): Promise<RunResult> {
  const def = SUBAGENTS[type];
  if (!def) throw new Error(`unknown subagent type: ${type}`);

  const readOnly: Record<string, unknown> = {
    ...buildFsTools(toolContext),
    ...buildSearchTools(toolContext),
  };
  const tools: Record<string, unknown> = {};
  for (const t of def.tools) {
    if (t in readOnly) tools[t] = readOnly[t];
  }

  // Sub-agents only run on a custom endpoint model.
  const ep = customEndpoints.find(
    (e) => isCompatModelId(modelId) && e.id === endpointIdFromCompatModel(modelId),
  );
  const model = await buildLanguageModel(
    "openai-compatible",
    keys,
    ep?.modelId.trim() || modelId,
    { openaiCompatibleBaseURL: ep?.baseURL },
    ep ? customEndpointKeys[ep.id] : undefined,
  );

  const start = Date.now();
  const result = await generateText({
    model,
    system: def.systemPrompt,
    prompt,
    tools: tools as Parameters<typeof generateText>[0]["tools"],
    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
    onStepFinish: (step) => {
      if (!onStep) return;
      const last = step.toolCalls?.[step.toolCalls.length - 1];
      if (last) onStep(`${type}: ${last.toolName}`);
    },
  });

  return {
    summary: result.text || "(no output)",
    stepCount: result.steps?.length ?? 0,
    durationMs: Date.now() - start,
  };
}
