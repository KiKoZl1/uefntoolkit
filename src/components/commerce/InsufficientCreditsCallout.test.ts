import { describe, expect, it, vi } from "vitest";
import { computeNextWeeklyUnlock, toInsufficientCreditsDetails } from "@/components/commerce/InsufficientCreditsCallout";

describe("toInsufficientCreditsDetails", () => {
  it("maps insufficient payload to normalized details", () => {
    const mapped = toInsufficientCreditsDetails({
      error_code: "INSUFFICIENT_CREDITS",
      credits_required: 15,
      weekly_wallet_available: 3,
      free_monthly_available: 2,
      extra_wallet_available: 1,
      recommended_action: "buy_credits",
    });

    expect(mapped).toEqual({
      creditsRequired: 15,
      weeklyAvailable: 3,
      freeMonthlyAvailable: 2,
      extraAvailable: 1,
      recommendedAction: "buy_credits",
      nextWeeklyUnlockAt: null,
    });
  });

  it("returns null for non-insufficient errors", () => {
    expect(toInsufficientCreditsDetails({ error_code: "ACCOUNT_SUSPENDED" })).toBeNull();
    expect(toInsufficientCreditsDetails({})).toBeNull();
    expect(toInsufficientCreditsDetails(null)).toBeNull();
  });
});

describe("computeNextWeeklyUnlock", () => {
  it("computes next weekly boundary inside cycle", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));

    const next = computeNextWeeklyUnlock({
      cycle_start: "2026-03-01T00:00:00.000Z",
      cycle_end: "2026-04-01T00:00:00.000Z",
    });

    expect(next).toBe("2026-03-15T00:00:00.000Z");
    vi.useRealTimers();
  });

  it("returns null when cycle fields are missing", () => {
    expect(computeNextWeeklyUnlock({})).toBeNull();
    expect(computeNextWeeklyUnlock(null)).toBeNull();
  });
});

