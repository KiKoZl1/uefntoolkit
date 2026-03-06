import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageStateProps } from "@/types/page-state";

function ActionButton({
  label,
  href,
  onClick,
  variant = "default",
}: {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "default" | "outline";
}) {
  if (href) {
    return (
      <Button asChild variant={variant}>
        <Link to={href}>{label}</Link>
      </Button>
    );
  }
  return (
    <Button variant={variant} onClick={onClick}>
      {label}
    </Button>
  );
}

export function PageState({
  variant = "section",
  tone = "default",
  title,
  description,
  icon,
  action,
  secondaryAction,
}: PageStateProps) {
  const iconNode =
    icon ||
    (tone === "error" ? (
      <AlertTriangle className="h-5 w-5 text-destructive" />
    ) : tone === "success" ? (
      <CheckCircle2 className="h-5 w-5 text-success" />
    ) : (
      <Loader2 className="h-5 w-5 text-primary animate-spin" />
    ));

  const wrapperClass =
    variant === "full-page"
      ? "min-h-[70vh] flex items-center justify-center"
      : variant === "compact"
        ? "py-4"
        : "py-12";

  const cardClass =
    variant === "compact"
      ? "border-border/60 bg-card/70"
      : "border-border/60 bg-card";

  return (
    <div className={wrapperClass}>
      <Card className={cn("mx-auto w-full max-w-2xl", cardClass)}>
        <CardContent className={cn("text-center", variant === "compact" ? "py-5" : "py-10")}>
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
            {iconNode}
          </div>
          <h3 className={cn("font-display font-semibold", variant === "compact" ? "text-base" : "text-lg")}>{title}</h3>
          {description ? <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{description}</p> : null}
          {(action || secondaryAction) && (
            <div className="mt-4 flex items-center justify-center gap-2">
              {action ? <ActionButton label={action.label} href={action.href} onClick={action.onClick} /> : null}
              {secondaryAction ? (
                <ActionButton
                  label={secondaryAction.label}
                  href={secondaryAction.href}
                  onClick={secondaryAction.onClick}
                  variant="outline"
                />
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
