import type { ModelMessage, SystemModelMessage } from "ai";
import type { ProviderId } from "@/modules/ai/config";

export type PreparedAgentPrompt = {
  system: SystemModelMessage[];
  messages: ModelMessage[];
};

export function prepareAgentPrompt(
  stableSystem: string,
  planInstructions: string | null,
  history: readonly ModelMessage[],
  provider: ProviderId,
): PreparedAgentPrompt {
  const system: SystemModelMessage[] = [
    { role: "system", content: stableSystem },
  ];
  if (planInstructions) {
    system.push({ role: "system", content: planInstructions });
  }
  void provider;
  return { system, messages: history.slice() };
}
