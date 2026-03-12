import { describe, expect, it } from "vitest";
import {
  isStripeTimestampWithinTolerance,
  parseStripeSignatureHeader,
} from "../../../supabase/functions/_shared/stripeSignature.ts";

describe("stripe signature parsing", () => {
  it("keeps all v1 signatures to support secret rotation", () => {
    const parsed = parseStripeSignatureHeader("t=1710000000,v1=sig_old,v1=sig_new,v0=legacy");
    expect(parsed.timestamp).toBe(1710000000);
    expect(parsed.signaturesV1).toEqual(["sig_old", "sig_new"]);
  });

  it("handles malformed header safely", () => {
    const parsed = parseStripeSignatureHeader("v1=only,broken,no_equals,t=abc");
    expect(parsed.timestamp).toBeNull();
    expect(parsed.signaturesV1).toEqual(["only"]);
  });
});

describe("stripe signature tolerance", () => {
  it("accepts timestamps inside tolerance", () => {
    expect(isStripeTimestampWithinTolerance(1000, 1200, 300)).toBe(true);
  });

  it("rejects timestamps outside tolerance", () => {
    expect(isStripeTimestampWithinTolerance(1000, 1405, 300)).toBe(false);
  });
});
