import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreditIconProps {
  className?: string;
  glyphClassName?: string;
}

export function CreditIcon({ className, glyphClassName }: CreditIconProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-primary/35 bg-primary/10 text-primary",
        className,
      )}
      aria-hidden="true"
    >
      <Coins className={cn("h-2.5 w-2.5", glyphClassName)} />
    </span>
  );
}

