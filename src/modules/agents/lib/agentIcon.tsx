import {
  AiBrowserIcon,
  CodeIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

function iconFor(agent: string): IconSvgElement {
  const a = agent.toLowerCase();
  if (a.includes("dsh")) return TerminalIcon;
  if (a.includes("pi")) return CodeIcon;
  return AiBrowserIcon;
}

export function AgentIcon({
  agent,
  size = 15,
  className,
}: {
  agent: string;
  size?: number;
  className?: string;
}) {
  if (agent.toLowerCase().includes("terax")) {
    return (
      <img
        src="/logo.png"
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={iconFor(agent)}
      size={size}
      strokeWidth={1.75}
      className={className}
    />
  );
}
