import { describe, expect, it } from "vitest";
import { applyTopbarCreditsUiEvent, type OptimisticCreditState, type TopBarCommerceSummary } from "@/lib/commerce/topbarCreditsUi";

function baseSummary(spendableNow: number): TopBarCommerceSummary {
  return {
    planType: "free",
    spendableNow,
    weeklyWallet: 0,
    freeMonthly: 0,
    extraWallet: 0,
  };
}

describe("applyTopbarCreditsUiEvent", () => {
  it("does not create visual credits when optimistic debit starts from zero", () => {
    const state: OptimisticCreditState = { appliedDebit: 0 };
    const afterOptimistic = applyTopbarCreditsUiEvent(
      baseSummary(0),
      { type: "optimistic_debit", amount: 4 },
      state,
    );
    expect(afterOptimistic.spendableNow).toBe(0);
    expect(state.appliedDebit).toBe(0);

    const afterRollback = applyTopbarCreditsUiEvent(
      afterOptimistic,
      { type: "rollback_debit", amount: 4 },
      state,
    );
    expect(afterRollback.spendableNow).toBe(0);
    expect(state.appliedDebit).toBe(0);
  });

  it("restores only what was effectively discounted", () => {
    const state: OptimisticCreditState = { appliedDebit: 0 };
    const afterOptimistic = applyTopbarCreditsUiEvent(
      baseSummary(2),
      { type: "optimistic_debit", amount: 4 },
      state,
    );
    expect(afterOptimistic.spendableNow).toBe(0);
    expect(state.appliedDebit).toBe(2);

    const afterRollback = applyTopbarCreditsUiEvent(
      afterOptimistic,
      { type: "rollback_debit", amount: 4 },
      state,
    );
    expect(afterRollback.spendableNow).toBe(2);
    expect(state.appliedDebit).toBe(0);
  });
});
