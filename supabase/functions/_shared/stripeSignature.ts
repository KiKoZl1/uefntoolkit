export type ParsedStripeSignature = {
  timestamp: number | null;
  signaturesV1: string[];
};

export function parseStripeSignatureHeader(signatureHeader: string): ParsedStripeSignature {
  const tokens = String(signatureHeader || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  let timestamp: number | null = null;
  const signaturesV1: string[] = [];

  for (const token of tokens) {
    const [key, ...rest] = token.split("=");
    const value = rest.join("=").trim();
    if (!key || !value) continue;

    if (key === "t") {
      const parsed = Number(value);
      timestamp = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
      continue;
    }

    if (key === "v1") {
      signaturesV1.push(value);
    }
  }

  return { timestamp, signaturesV1 };
}

export function isStripeTimestampWithinTolerance(
  timestampUnixSeconds: number,
  nowUnixSeconds: number,
  toleranceSeconds: number,
): boolean {
  if (!Number.isFinite(timestampUnixSeconds) || timestampUnixSeconds <= 0) return false;
  if (!Number.isFinite(nowUnixSeconds) || nowUnixSeconds <= 0) return false;
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) return false;
  return Math.abs(nowUnixSeconds - timestampUnixSeconds) <= toleranceSeconds;
}
