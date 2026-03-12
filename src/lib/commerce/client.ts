import { supabase } from "@/integrations/supabase/client";
import { getCommerceDeviceFingerprintHash } from "@/lib/commerce/deviceFingerprint";
import { getToolCost } from "@/lib/commerce/toolCosts";

type Method = "GET" | "POST";

type CacheOptions = {
  key: string;
  ttlMs: number;
  forceRefresh?: boolean;
};

const commerceResponseCache = new Map<string, { expiresAt: number; value: unknown }>();
const commerceInFlight = new Map<string, Promise<unknown>>();
export const COMMERCE_CREDITS_UI_EVENT = "commerce:credits-ui";

type CommerceCreditsUiEventDetail =
  | { type: "optimistic_debit"; amount: number }
  | { type: "rollback_debit"; amount: number }
  | {
      type: "sync_from_execute";
      weekly_wallet_available: number;
      free_monthly_available: number;
      extra_wallet_available: number;
      spendable_now: number;
    };

function toSafeInt(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

function dispatchCreditsUiEvent(detail: CommerceCreditsUiEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMMERCE_CREDITS_UI_EVENT, { detail }));
}

async function getAuthHeaders(idempotencyKey?: string): Promise<Record<string, string>> {
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
  const anonKey = String(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "",
  ).trim();
  if (!supabaseUrl || !anonKey) throw new Error("missing_supabase_env");

  const sessionRes = await supabase.auth.getSession();
  const token = sessionRes.data.session?.access_token;
  if (!token) throw new Error("missing_user_session");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
  };
  const deviceFingerprintHash = await getCommerceDeviceFingerprintHash();
  if (deviceFingerprintHash) headers["x-device-fingerprint-hash"] = deviceFingerprintHash;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

function appendFingerprintToPath(path: string, deviceFingerprintHash?: string): string {
  if (!deviceFingerprintHash) return path;
  const hasQuery = path.includes("?");
  const sep = hasQuery ? "&" : "?";
  return `${path}${sep}dfp=${encodeURIComponent(deviceFingerprintHash)}`;
}

async function request(
  path: string,
  method: Method,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
  cacheOptions?: CacheOptions,
) {
  const shouldUseCache = method === "GET" && !!cacheOptions?.key;
  const cacheKey = cacheOptions?.key || "";

  if (shouldUseCache && !cacheOptions?.forceRefresh) {
    const cached = commerceResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const inFlight = commerceInFlight.get(cacheKey);
    if (inFlight) return await inFlight;
  }

  const fetchPromise = (async () => {
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
  const headers = await getAuthHeaders(idempotencyKey);
  const deviceFingerprintHash = String(headers["x-device-fingerprint-hash"] || "").trim();
  const requestPath = appendFingerprintToPath(path, deviceFingerprintHash || undefined);
  const url = `${supabaseUrl}/functions/v1/commerce${requestPath}`;
  const requestBody = method === "POST"
    ? {
        ...(body || {}),
        ...(deviceFingerprintHash ? { device_fingerprint_hash: deviceFingerprintHash } : {}),
      }
    : undefined;
  const resp = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(requestBody || {}) : undefined,
  });

  const text = await resp.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: text || "invalid_json_response" };
  }

  if (!resp.ok) {
    const error = String(parsed?.error || parsed?.error_code || `commerce_http_${resp.status}`);
    const err = new Error(error);
    (err as any).payload = parsed;
    (err as any).status = resp.status;
    throw err;
  }

    if (shouldUseCache && cacheOptions && cacheOptions.ttlMs > 0) {
      commerceResponseCache.set(cacheKey, {
        expiresAt: Date.now() + cacheOptions.ttlMs,
        value: parsed,
      });
    }

  return parsed;
  })();

  if (shouldUseCache) {
    commerceInFlight.set(cacheKey, fetchPromise);
  }

  try {
    return await fetchPromise;
  } finally {
    if (shouldUseCache) commerceInFlight.delete(cacheKey);
  }
}

export function invalidateCommerceCache(keys?: string[]) {
  if (!keys || keys.length === 0) {
    commerceResponseCache.clear();
    commerceInFlight.clear();
    return;
  }

  for (const key of keys) {
    commerceResponseCache.delete(key);
    commerceInFlight.delete(key);
  }
}

export async function getCommerceCredits(args?: { forceRefresh?: boolean }) {
  return await request("/me/credits", "GET", undefined, undefined, {
    key: "me_credits",
    ttlMs: 10_000,
    forceRefresh: args?.forceRefresh,
  });
}

export async function getCommerceCreditsSummary(args?: { forceRefresh?: boolean }) {
  return await request("/me/credits/summary", "GET", undefined, undefined, {
    key: "me_credits_summary",
    ttlMs: 10_000,
    forceRefresh: args?.forceRefresh,
  });
}

export async function getCommerceLedger(limit = 50, beforeId?: number) {
  const qs = beforeId ? `?limit=${Math.max(1, limit)}&before_id=${beforeId}` : `?limit=${Math.max(1, limit)}`;
  return await request(`/me/ledger${qs}`, "GET");
}

export async function executeCommerceTool(args: {
  toolCode: "surprise_gen" | "edit_studio" | "camera_control" | "layer_decomposition" | "psd_to_umg" | "umg_to_verse";
  payload: Record<string, unknown>;
  requestId?: string;
  idempotencyKey?: string;
}) {
  const requestId = args.requestId || crypto.randomUUID();
  const idempotencyKey = args.idempotencyKey || crypto.randomUUID();
  const optimisticCost = getToolCost(args.toolCode);
  if (optimisticCost > 0) {
    dispatchCreditsUiEvent({ type: "optimistic_debit", amount: optimisticCost });
  }

  try {
    const response = await request(
      "/tools/execute",
      "POST",
      {
        tool_code: args.toolCode,
        payload: args.payload,
        request_id: requestId,
        idempotency_key: idempotencyKey,
      },
      idempotencyKey,
    );

    invalidateCommerceCache(["me_credits", "me_credits_summary"]);
    dispatchCreditsUiEvent({
      type: "sync_from_execute",
      weekly_wallet_available: toSafeInt((response as any)?.remaining_weekly_available),
      free_monthly_available: toSafeInt((response as any)?.remaining_free_monthly_available),
      extra_wallet_available: toSafeInt((response as any)?.remaining_extra_wallet),
      spendable_now: toSafeInt(
        ((response as any)?.remaining_weekly_available ?? 0) +
          ((response as any)?.remaining_free_monthly_available ?? 0) +
          ((response as any)?.remaining_extra_wallet ?? 0),
      ),
    });

    return response;
  } catch (error) {
    if (optimisticCost > 0) {
      dispatchCreditsUiEvent({ type: "rollback_debit", amount: optimisticCost });
    }
    invalidateCommerceCache(["me_credits", "me_credits_summary"]);
    throw error;
  }
}

export async function reverseCommerceOperation(args: {
  operationId: string;
  reason?: string;
  idempotencyKey?: string;
}) {
  const idempotencyKey = args.idempotencyKey || crypto.randomUUID();
  return await request(
    "/tools/reverse",
    "POST",
    {
      operation_id: args.operationId,
      reason: args.reason || "client_reversal",
      idempotency_key: idempotencyKey,
    },
    idempotencyKey,
  );
}

export async function createSubscriptionCheckout(args?: {
  idempotencyKey?: string;
  successUrl?: string;
  cancelUrl?: string;
}) {
  const idempotencyKey = args?.idempotencyKey || crypto.randomUUID();
  return await request(
    "/billing/subscription/checkout",
    "POST",
    {
      plan_code: "pro",
      success_url: args?.successUrl || undefined,
      cancel_url: args?.cancelUrl || undefined,
      idempotency_key: idempotencyKey,
    },
    idempotencyKey,
  );
}

export async function listCreditPacks() {
  return await request("/billing/packs", "GET", undefined, undefined, {
    key: "billing_packs",
    ttlMs: 60_000,
  });
}

export async function createPackCheckout(
  packCode: "pack_250" | "pack_650" | "pack_1400",
  args?: {
    idempotencyKey?: string;
    successUrl?: string;
    cancelUrl?: string;
  },
) {
  const idempotencyKey = args?.idempotencyKey || crypto.randomUUID();
  return await request(
    `/billing/packs/${packCode}/checkout`,
    "POST",
    {
      success_url: args?.successUrl || undefined,
      cancel_url: args?.cancelUrl || undefined,
      idempotency_key: idempotencyKey,
    },
    idempotencyKey,
  );
}

export async function adminGetCommerceUser(userId: string) {
  return await request(`/admin/user/${encodeURIComponent(userId)}`, "GET");
}

export async function adminFindCommerceUserByEmail(email: string) {
  const normalized = String(email || "").trim().toLowerCase();
  return await request(`/admin/user-lookup?email=${encodeURIComponent(normalized)}`, "GET");
}

export async function adminGrantCredits(args: {
  userId: string;
  walletType: "extra_wallet" | "weekly_wallet" | "free_monthly";
  credits: number;
  reason: string;
  idempotencyKey?: string;
}) {
  const idempotencyKey = args.idempotencyKey || crypto.randomUUID();
  return await request(
    "/admin/credits/grant",
    "POST",
    {
      user_id: args.userId,
      wallet_type: args.walletType,
      credits: args.credits,
      reason: args.reason,
      idempotency_key: idempotencyKey,
    },
    idempotencyKey,
  );
}

export async function adminDebitCredits(args: {
  userId: string;
  walletType: "extra_wallet" | "weekly_wallet" | "free_monthly";
  credits: number;
  reason: string;
  idempotencyKey?: string;
}) {
  const idempotencyKey = args.idempotencyKey || crypto.randomUUID();
  return await request(
    "/admin/credits/debit",
    "POST",
    {
      user_id: args.userId,
      wallet_type: args.walletType,
      credits: args.credits,
      reason: args.reason,
      idempotency_key: idempotencyKey,
    },
    idempotencyKey,
  );
}

export async function adminSetAbuseReview(args: {
  userId: string;
  action: "approve" | "review" | "block";
  reason?: string;
  idempotencyKey?: string;
}) {
  const idempotencyKey = args.idempotencyKey || crypto.randomUUID();
  return await request(
    `/admin/user/${encodeURIComponent(args.userId)}/abuse-review`,
    "POST",
    {
      action: args.action,
      reason: args.reason || "",
      idempotency_key: idempotencyKey,
    },
    idempotencyKey,
  );
}

export async function adminSetSuspension(args: {
  userId: string;
  suspend: boolean;
  idempotencyKey?: string;
}) {
  const idempotencyKey = args.idempotencyKey || crypto.randomUUID();
  return await request(
    `/admin/user/${encodeURIComponent(args.userId)}/suspend`,
    "POST",
    {
      suspend: args.suspend,
      idempotency_key: idempotencyKey,
    },
    idempotencyKey,
  );
}
