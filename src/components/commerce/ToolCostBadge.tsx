interface ToolCostBadgeProps {
  cost: number;
  className?: string;
}

export function ToolCostBadge({ cost, className }: ToolCostBadgeProps) {
  return (
    <span
      className={[
        "inline-flex h-9 items-center rounded-lg border border-primary/45 bg-primary/5 px-3 text-sm font-semibold text-primary",
        className || "",
      ].join(" ")}
      aria-label={`Custo de ${cost} creditos`}
      title={`Custo de ${cost} creditos`}
    >
      {cost} creditos
    </span>
  );
}

