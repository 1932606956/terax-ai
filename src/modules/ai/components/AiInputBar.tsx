import { Button } from "@/components/ui/button";
import { t } from "@/i18n/zh";
import { PlugIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/** Shown instead of the composer until an endpoint is usable. */
export function AiInputBarConnect({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="shrink-0 border-t border-border/60 bg-foreground/[0.02] px-3 py-2">
      <div className="flex h-10 items-center justify-between gap-3 rounded-lg px-3 text-xs">
        <span className="text-muted-foreground">{t("ai.noEndpointSend")}</span>
        <Button size="xs" onClick={onAdd}>
          <HugeiconsIcon icon={PlugIcon} />
          {t("ai.addEndpoint")}
        </Button>
      </div>
    </div>
  );
}
