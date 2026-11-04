const LABELS: Record<string, string> = {
  "dsh-tui": "dsh-tui",
  "oh-my-pi": "oh-my-pi",
  terax: "Terax",
};

/**
 * Display name for an agent id. Custom agents carry their own label, so this
 * only covers the ids that reach notifications without one.
 */
export function displayAgent(agent: string): string {
  if (!agent) return "Agent";
  return (
    LABELS[agent.toLowerCase()] ??
    agent.charAt(0).toUpperCase() + agent.slice(1)
  );
}
