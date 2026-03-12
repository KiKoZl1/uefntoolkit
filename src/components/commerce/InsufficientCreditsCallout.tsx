import { useEffect, useMemo, useState } from "react";
import { Clock3, Wallet, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type CycleInfo = {
  cycle_start?: string | null;
  cycle_end?: string | null;
};

export type InsufficientCreditsDetails = {
  creditsRequired: number;
  weeklyAvailable: number;
  freeMonthlyAvailable: number;
  extraAvailable: number;
  recommendedAction: string;
  nextWeeklyUnlockAt?: string | null;
};

function toSafeInt(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

function toSafeString(value: unknown): string {
  return String(value || "").trim();
}

export function computeNextWeeklyUnlock(cycle: CycleInfo | null | undefined): string | null {
  if (!cycle?.cycle_start || !cycle?.cycle_end) return null;
  const start = new Date(cycle.cycle_start).getTime();
  const end = new Date(cycle.cycle_end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= start) return null;
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  if (now >= end) return cycle.cycle_end;
  const elapsed = Math.max(0, now - start);
  const next = start + (Math.floor(elapsed / weekMs) + 1) * weekMs;
  return new Date(Math.min(next, end)).toISOString();
}

export function toInsufficientCreditsDetails(payload: unknown): InsufficientCreditsDetails | null {
  const raw = (payload && typeof payload === "object") ? payload as Record<string, unknown> : {};
  const errorCode = toSafeString(raw.error_code).toUpperCase();
  if (errorCode !== "INSUFFICIENT_CREDITS") return null;

  return {
    creditsRequired: toSafeInt(raw.credits_required),
    weeklyAvailable: toSafeInt(raw.weekly_wallet_available),
    freeMonthlyAvailable: toSafeInt(raw.free_monthly_available),
    extraAvailable: toSafeInt(raw.extra_wallet_available),
    recommendedAction: toSafeString(raw.recommended_action || "buy_credits"),
    nextWeeklyUnlockAt: toSafeString(raw.next_weekly_unlock_at) || null,
  };
}

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

interface InsufficientCreditsCalloutProps {
  details: InsufficientCreditsDetails;
  className?: string;
  onDismiss?: () => void;
}

export function InsufficientCreditsCallout({ details, className, onDismiss }: InsufficientCreditsCalloutProps) {
  const [open, setOpen] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [resolvedNextWeeklyUnlockAt, setResolvedNextWeeklyUnlockAt] = useState<string | null>(details.nextWeeklyUnlockAt || null);
  const totalAvailable = details.weeklyAvailable + details.freeMonthlyAvailable + details.extraAvailable;
  const missingCredits = Math.max(0, details.creditsRequired - totalAvailable);
  const balanceParts = [
    { label: "Weekly", value: details.weeklyAvailable },
    { label: "Free", value: details.freeMonthlyAvailable },
    { label: "Extra", value: details.extraAvailable },
  ];
  const nonZeroParts = balanceParts.filter((part) => part.value > 0);
  const unlockTs = resolvedNextWeeklyUnlockAt ? new Date(resolvedNextWeeklyUnlockAt).getTime() : NaN;
  const hasValidUnlock = Number.isFinite(unlockTs) && unlockTs > 0;
  const msRemaining = hasValidUnlock ? unlockTs - nowMs : NaN;
  const shouldShowTimer = hasValidUnlock && msRemaining > 0;

  useEffect(() => {
    setResolvedNextWeeklyUnlockAt(details.nextWeeklyUnlockAt || null);
    setOpen(true);
  }, [details.nextWeeklyUnlockAt]);

  useEffect(() => {
    if (!shouldShowTimer) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [shouldShowTimer]);

  useEffect(() => {
    if (resolvedNextWeeklyUnlockAt) return;

    let cancelled = false;
    const loadCycle = async () => {
      try {
        const commerceClient = await import("@/lib/commerce/client");
        if (typeof commerceClient.getCommerceCredits !== "function") return;
        const credits = await commerceClient.getCommerceCredits();
        const computed = computeNextWeeklyUnlock((credits as { cycle?: CycleInfo } | null)?.cycle || null);
        if (!cancelled && computed) {
          setResolvedNextWeeklyUnlockAt(computed);
          setNowMs(Date.now());
        }
      } catch {
        // best effort only
      }
    };

    void loadCycle();
    return () => {
      cancelled = true;
    };
  }, [resolvedNextWeeklyUnlockAt]);

  const countdownLabel = useMemo(() => {
    if (shouldShowTimer) return formatCountdown(msRemaining);
    if (hasValidUnlock) return "liberacao disponivel agora";
    return null;
  }, [hasValidUnlock, msRemaining, shouldShowTimer]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) onDismiss?.();
      }}
    >
      <DialogContent
        className={[
          "max-w-[420px] space-y-3 border-border bg-card text-foreground pr-12 [&>button]:hidden",
          className || "",
        ].join(" ")}
      >
        <DialogClose asChild>
          <button
            type="button"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Fechar aviso de creditos"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogClose>

        <DialogHeader className="space-y-2 pr-2 text-left">
          <DialogTitle className="flex items-start gap-2 text-lg font-bold text-primary">
            <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            Ah nao, voce esta sem creditos para esta execucao.
          </DialogTitle>
          <DialogDescription className="text-sm text-foreground/90">
            Faltam <strong>{missingCredits}</strong> creditos para continuar.
          </DialogDescription>
        </DialogHeader>

        {nonZeroParts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {nonZeroParts.map((part) => (
              <span key={part.label} className="rounded-full border border-border bg-background/50 px-2 py-0.5">
                {part.label}: {part.value}
              </span>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-foreground/90">
          <div className="flex items-center gap-2">
            <Clock3 className="h-3.5 w-3.5 text-primary" />
            {countdownLabel
              ? <span>Proxima liberacao semanal em: <strong>{countdownLabel}</strong></span>
              : <span>Sem liberacao automatica no momento. Compre creditos extras para continuar agora.</span>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" asChild onClick={() => setOpen(false)}>
            <Link to="/app/credits#credit-packs">Comprar creditos extras agora</Link>
          </Button>
          <Button size="sm" variant="outline" asChild onClick={() => setOpen(false)}>
            <Link to="/app/billing">Ver detalhes do plano</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
