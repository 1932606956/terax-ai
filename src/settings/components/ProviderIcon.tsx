import type { ProviderId } from "@/modules/ai/config";
import { PlugIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Props = {
  provider: ProviderId;
  size?: number;
  className?: string;
};

/** Every model now comes from a custom endpoint, so there is one icon. */
export function ProviderIcon({ size = 14, className }: Props) {
  return (
    <HugeiconsIcon
      icon={PlugIcon}
      size={size}
      strokeWidth={1.75}
      className={className}
    />
  );
}
