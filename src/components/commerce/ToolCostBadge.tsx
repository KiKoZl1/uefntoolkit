import { CreditIcon } from "@/components/commerce/CreditIcon";

interface ToolCostBadgeProps {
  cost: number;
  className?: string;
}

export function ToolCostBadge({ cost, className }: ToolCostBadgeProps) {
  return (
    <span
      className={[
        "inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/45 bg-primary/5 px-3 text-sm font-semibold text-primary",
        className || "",
      ].join(" ")}
      aria-label={`Custo de ${cost} creditos`}
      title={`Custo de ${cost} creditos`}
    >
      <CreditIcon className="h-4 w-4" glyphClassName="h-2.5 w-2.5" />
      <span className="tabular-nums">{cost}</span>
    </span>
  );
}

