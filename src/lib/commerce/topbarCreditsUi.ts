export type TopBarCommerceSummary = {
  planType: "free" | "pro";
  spendableNow: number;
  weeklyWallet: number;
  freeMonthly: number;
  extraWallet: number;
};

export type CommerceCreditsUiEventDetail =
  | { type: "optimistic_debit"; amount: number }
  | { type: "rollback_debit"; amount: number }
  | {
      type: "sync_from_execute";
      weekly_wallet_available: number;
      free_monthly_available: number;
      extra_wallet_available: number;
      spendable_now: number;
    };

export type OptimisticCreditState = {
  appliedDebit: number;
};

function toSafeInt(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

function applyDelta(value: number, delta: number): number {
  return Math.max(0, Math.floor(value + delta));
}

export function applyTopbarCreditsUiEvent(
  base: TopBarCommerceSummary,
  detail: CommerceCreditsUiEventDetail,
  optimisticState: OptimisticCreditState,
): TopBarCommerceSummary {
  if (detail.type === "optimistic_debit") {
    const amount = toSafeInt(detail.amount);
    if (amount <= 0) return base;
    const applied = Math.min(base.spendableNow, amount);
    if (applied <= 0) return base;
    optimisticState.appliedDebit += applied;
    return {
      ...base,
      spendableNow: applyDelta(base.spendableNow, -applied),
    };
  }

  if (detail.type === "rollback_debit") {
    const amount = toSafeInt(detail.amount);
    if (amount <= 0) return base;
    const refundable = Math.min(optimisticState.appliedDebit, amount);
    if (refundable <= 0) return base;
    optimisticState.appliedDebit -= refundable;
    return {
      ...base,
      spendableNow: applyDelta(base.spendableNow, refundable),
    };
  }

  optimisticState.appliedDebit = 0;
  return {
    ...base,
    weeklyWallet: toSafeInt(detail.weekly_wallet_available),
    freeMonthly: toSafeInt(detail.free_monthly_available),
    extraWallet: toSafeInt(detail.extra_wallet_available),
    spendableNow: toSafeInt(detail.spendable_now),
  };
}
