
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCommerceRoleFlags } from "../_shared/commerceAuthz.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key, stripe-signature, x-commerce-internal-secret, x-device-fingerprint-hash",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type AuthedUser = {
  userId: string;
  email: string;
  token: string;
  isAdmin: boolean;
  isEditor: boolean;
};

type JsonRecord = Record<string, unknown>;

type ToolCode =
  | "surprise_gen"
  | "edit_studio"
  | "camera_control"
  | "layer_decomposition"
  | "psd_to_umg"
  | "umg_to_verse";

type SubscriptionStatus = "inactive" | "active" | "past_due" | "cancel_at_period_end" | "expired" | "canceled";

const TOOL_FUNCTION_MAP: Record<Exclude<ToolCode, "psd_to_umg" | "umg_to_verse">, string> = {
  surprise_gen: "tgis-generate",
  edit_studio: "tgis-edit-studio",
  camera_control: "tgis-camera-control",
  layer_decomposition: "tgis-layer-decompose",
};

function json(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function mustEnv(name: string): string {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function optionalEnv(name: string): string {
  return String(Deno.env.get(name) || "").trim();
}

function envInt(name: string, fallback: number, min = 1, max = 1_000_000): number {
  const raw = Number(optionalEnv(name));
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function extractBearer(req: Request): string {
  const header = normalizeText(req.headers.get("Authorization") || req.headers.get("authorization"));
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function getIdempotencyKey(req: Request, body: JsonRecord): string {
  const headerKey = normalizeText(req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key"));
  const bodyKey = normalizeText(body.idempotency_key || body.idempotencyKey);
  return headerKey || bodyKey;
}

function pathAfterFunction(req: Request, fnName: string): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === fnName);
  if (idx < 0) return "/";
  const suffix = parts.slice(idx + 1).join("/");
  return `/${suffix}`.replace(/\/+$/, "") || "/";
}

function decodeQueryInt(url: URL, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(url.searchParams.get(key));
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function getClientIp(req: Request): string {
  const xff = normalizeText(req.headers.get("x-forwarded-for"));
  if (xff) return normalizeText(xff.split(",")[0]);
  const realIp = normalizeText(req.headers.get("x-real-ip"));
  if (realIp) return realIp;
  const cfIp = normalizeText(req.headers.get("cf-connecting-ip"));
  if (cfIp) return cfIp;
  return "unknown";
}

function normalizeFingerprint(value: unknown): string | null {
  const raw = normalizeText(value).toLowerCase();
  if (!raw) return null;
  if (!/^[a-f0-9]{64}$/.test(raw)) return null;
  return raw;
}

function extractDeviceFingerprintHash(req: Request, body?: JsonRecord): string | null {
  const fromHeader = normalizeFingerprint(req.headers.get("x-device-fingerprint-hash"));
  if (fromHeader) return fromHeader;

  const fromQuery = normalizeFingerprint(new URL(req.url).searchParams.get("dfp"));
  if (fromQuery) return fromQuery;

  const fromBody = normalizeFingerprint(body?.device_fingerprint_hash);
  if (fromBody) return fromBody;

  return null;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret);
  const msgData = new TextEncoder().encode(payload);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, msgData);
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJsonBody(req: Request): Promise<JsonRecord> {
  return await req.json().catch(() => ({}));
}

function createServiceClient() {
  return createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

async function resolveUser(req: Request, service: ReturnType<typeof createClient>): Promise<AuthedUser | null> {
  const token = extractBearer(req);
  if (!token) return null;

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user?.id) return null;

  const { data: roleRows } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .limit(1);

  const role = normalizeText(roleRows?.[0]?.role);
  const roleFlags = resolveCommerceRoleFlags(role);

  return {
    userId: data.user.id,
    email: normalizeText(data.user.email),
    token,
    isAdmin: roleFlags.isAdmin,
    isEditor: roleFlags.isEditor,
  };
}

function requireFinancialAdmin(user: AuthedUser) {
  if (!user.isAdmin) throw new Error("forbidden");
}

function requireInternalOrAdmin(req: Request, user: AuthedUser | null) {
  const secret = optionalEnv("COMMERCE_INTERNAL_SECRET");
  const incoming = normalizeText(req.headers.get("x-commerce-internal-secret"));
  const internalAllowed = secret && incoming && incoming === secret;
  if (internalAllowed) return;
  if (user?.isAdmin) return;
  throw new Error("forbidden");
}

async function invokeToolFunction(args: {
  functionName: string;
  userToken: string;
  toolCode: ToolCode;
  operationId: string;
  idempotencyKey: string;
  userId: string;
  payload: JsonRecord;
}): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const supabaseUrl = mustEnv("SUPABASE_URL");
  const anonKey = mustEnv("SUPABASE_ANON_KEY");
  const gatewaySecret = optionalEnv("COMMERCE_GATEWAY_SECRET");
  if (!gatewaySecret) {
    return { ok: false, status: 503, data: null, error: "commerce_gateway_misconfigured" };
  }

  const signature = await hmacSha256Hex(gatewaySecret, `${args.operationId}:${args.userId}:${args.toolCode}`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${args.userToken}`,
    "apikey": anonKey,
    "x-commerce-gateway-signature": signature,
    "x-commerce-operation-id": args.operationId,
    "x-commerce-user-id": args.userId,
    "x-commerce-tool-code": args.toolCode,
    "x-commerce-idempotency-key": args.idempotencyKey,
  };

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/${encodeURIComponent(args.functionName)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...args.payload,
        commerceContext: {
          operation_id: args.operationId,
          tool_code: args.toolCode,
        },
      }),
    });

    const text = await resp.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }

    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        data: parsed,
        error: normalizeText(parsed?.error) || `tool_dispatch_failed_${resp.status}`,
      };
    }

    if (parsed && parsed.success === false) {
      return {
        ok: false,
        status: 422,
        data: parsed,
        error: normalizeText(parsed?.error) || "tool_execution_failed",
      };
    }

    return { ok: true, status: resp.status, data: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 502, data: null, error: message };
  }
}

function shouldAutoReverseFailure(status: number, errorCode: string): boolean {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) return true;
  if (errorCode.includes("missing_") || errorCode.includes("invalid_")) return true;
  if (errorCode.includes("commerce_gateway_")) return true;
  return false;
}

async function stripeCreateCheckoutSession(args: {
  mode: "subscription" | "payment";
  priceId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const stripeKey = optionalEnv("STRIPE_SECRET_KEY");
  if (!stripeKey) throw new Error("stripe_not_configured");

  const params = new URLSearchParams();
  params.set("mode", args.mode);
  params.set("line_items[0][price]", args.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", args.successUrl);
  params.set("cancel_url", args.cancelUrl);
  if (args.customerEmail) params.set("customer_email", args.customerEmail);

  Object.entries(args.metadata).forEach(([k, v]) => {
    params.set(`metadata[${k}]`, v);
  });

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const text = await resp.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { error: { message: text } };
  }

  if (!resp.ok) {
    throw new Error(normalizeText(parsed?.error?.message) || `stripe_http_${resp.status}`);
  }

  const id = normalizeText(parsed?.id);
  const url = normalizeText(parsed?.url);
  if (!id || !url) throw new Error("stripe_session_missing_fields");
  return { id, url };
}

function toIsoFromUnix(value: unknown): string | null {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return new Date(raw * 1000).toISOString();
}

function mapStripeSubscriptionStatus(
  value: unknown,
  cancelAtPeriodEnd?: unknown,
): SubscriptionStatus {
  const status = normalizeText(value).toLowerCase();
  const wantsCancelAtPeriodEnd = Boolean(cancelAtPeriodEnd);
  if (wantsCancelAtPeriodEnd && (status === "active" || status === "trialing")) return "cancel_at_period_end";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled") return "canceled";
  if (status === "incomplete_expired") return "expired";
  if (status === "active" || status === "trialing") return "active";
  return "inactive";
}

function buildStripeSubscriptionSnapshot(raw: any): {
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
} {
  return {
    status: mapStripeSubscriptionStatus(raw?.status, raw?.cancel_at_period_end),
    current_period_start: toIsoFromUnix(raw?.current_period_start),
    current_period_end: toIsoFromUnix(raw?.current_period_end),
    cancel_at_period_end: Boolean(raw?.cancel_at_period_end),
  };
}

async function stripeFetchSubscriptionDetails(subscriptionId: string): Promise<{
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}> {
  const stripeKey = optionalEnv("STRIPE_SECRET_KEY");
  if (!stripeKey) throw new Error("stripe_not_configured");

  const resp = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${stripeKey}`,
    },
  });

  const text = await resp.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: { message: text } };
  }

  if (!resp.ok) {
    throw new Error(normalizeText(parsed?.error?.message) || `stripe_subscription_http_${resp.status}`);
  }

  return buildStripeSubscriptionSnapshot(parsed);
}

function mapPackCodeToConfigKey(packCode: string): string | null {
  if (packCode === "pack_250") return "pack_small_credits";
  if (packCode === "pack_650") return "pack_medium_credits";
  if (packCode === "pack_1400") return "pack_large_credits";
  return null;
}

function buildPackCatalog(configRows: Array<{ config_key: string; value_json: any }>): Array<{ pack_code: string; credits: number }> {
  const map = new Map(configRows.map((r) => [r.config_key, r.value_json]));
  const get = (key: string, fallback: number) => {
    const raw = Number(map.get(key)?.value);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  };

  return [
    { pack_code: "pack_250", credits: get("pack_small_credits", 250) },
    { pack_code: "pack_650", credits: get("pack_medium_credits", 650) },
    { pack_code: "pack_1400", credits: get("pack_large_credits", 1400) },
  ];
}

function buildToolCostCatalog(configRows: Array<{ config_key: string; value_json: any }>) {
  const map = new Map(configRows.map((r) => [r.config_key, r.value_json]));
  const get = (key: string, fallback: number) => {
    const raw = Number(map.get(key)?.value);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  };

  return {
    surprise_gen: get("tool_cost_surprise_gen", 15),
    edit_studio: get("tool_cost_edit_studio", 4),
    camera_control: get("tool_cost_camera_control", 3),
    layer_decomposition: get("tool_cost_layer_decomposition", 8),
    psd_to_umg: get("tool_cost_psd_to_umg", 2),
    umg_to_verse: get("tool_cost_umg_to_verse", 2),
  };
}

function stripeVerifySignature(rawBody: string, signatureHeader: string, secret: string): Promise<boolean> {
  return (async () => {
    const parts = signatureHeader.split(",").map((x) => x.trim());
    const t = parts.find((x) => x.startsWith("t="))?.slice(2) || "";
    const v1 = parts.find((x) => x.startsWith("v1="))?.slice(3) || "";
    if (!t || !v1) return false;
    const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
    return constantTimeEqual(v1, expected);
  })();
}

function buildWalletSummary(wallet: any, planType: string) {
  const weeklyAvailable = Math.max(0, Number(wallet?.weekly_wallet || 0));
  const freeMonthlyAvailable = Math.max(0, Number(wallet?.free_monthly_remaining || 0));
  const extraWalletAvailable = Math.max(0, Number(wallet?.extra_wallet || 0));
  const monthlyPlanRemaining = Math.max(0, Number(wallet?.monthly_plan_remaining || 0));
  const spendableNow = weeklyAvailable + freeMonthlyAvailable + extraWalletAvailable;

  return {
    spendable_now: spendableNow,
    weekly_wallet_available: weeklyAvailable,
    free_monthly_available: freeMonthlyAvailable,
    extra_wallet_available: extraWalletAvailable,
    monthly_plan_remaining: monthlyPlanRemaining,
    plan_type: normalizeText(planType || "free"),
  };
}

async function handleMeCredits(req: Request, service: ReturnType<typeof createClient>, user: AuthedUser) {
  const deviceFingerprintHash = extractDeviceFingerprintHash(req);
  await service.rpc("commerce_ensure_account", { p_user_id: user.userId, p_device_fingerprint_hash: deviceFingerprintHash });
  await service.rpc("commerce_open_cycle_if_needed", { p_user_id: user.userId, p_now: new Date().toISOString(), p_idempotency_prefix: "cycle_open" });
  await service.rpc("commerce_sync_access_state", { p_user_id: user.userId });

  const [{ data: account }, { data: wallet }, { data: sub }] = await Promise.all([
    service.from("commerce_accounts").select("*").eq("user_id", user.userId).maybeSingle(),
    service.from("commerce_wallets").select("*").eq("user_id", user.userId).maybeSingle(),
    service.from("commerce_subscriptions").select("*").eq("user_id", user.userId).maybeSingle(),
  ]);

  let cycle: any = null;
  if (wallet?.current_cycle_id) {
    const { data } = await service.from("commerce_billing_cycles").select("*").eq("id", wallet.current_cycle_id).maybeSingle();
    cycle = data;
  }

  return json({
    success: true,
    account,
    wallet,
    cycle,
    subscription: sub || null,
    summary: buildWalletSummary(wallet, account?.plan_type),
  });
}

async function handleMeCreditsSummary(req: Request, service: ReturnType<typeof createClient>, user: AuthedUser) {
  const deviceFingerprintHash = extractDeviceFingerprintHash(req);
  await service.rpc("commerce_ensure_account", { p_user_id: user.userId, p_device_fingerprint_hash: deviceFingerprintHash });

  let { data: account } = await service
    .from("commerce_accounts")
    .select("plan_type,access_state")
    .eq("user_id", user.userId)
    .maybeSingle();

  let { data: wallet } = await service
    .from("commerce_wallets")
    .select("current_cycle_id,weekly_wallet,monthly_plan_remaining,extra_wallet,free_monthly_remaining")
    .eq("user_id", user.userId)
    .maybeSingle();

  if (!wallet?.current_cycle_id) {
    await service.rpc("commerce_open_cycle_if_needed", { p_user_id: user.userId, p_now: new Date().toISOString(), p_idempotency_prefix: "cycle_open_topbar" });
    const refreshed = await service
      .from("commerce_wallets")
      .select("current_cycle_id,weekly_wallet,monthly_plan_remaining,extra_wallet,free_monthly_remaining")
      .eq("user_id", user.userId)
      .maybeSingle();
    wallet = refreshed.data;
  }

  const summary = buildWalletSummary(wallet, account?.plan_type);
  return json({
    success: true,
    account: account || null,
    wallet: wallet || null,
    summary,
  });
}

async function handleMeLedger(req: Request, service: ReturnType<typeof createClient>, user: AuthedUser) {
  const url = new URL(req.url);
  const limit = decodeQueryInt(url, "limit", 50, 1, 200);
  const beforeId = decodeQueryInt(url, "before_id", 0, 0, Number.MAX_SAFE_INTEGER);

  let query = service
    .from("commerce_ledger")
    .select("id,user_id,cycle_id,wallet_type,entry_type,tool_code,delta,operation_id,reference_id,idempotency_key,reason,metadata_json,actor_user_id,actor_role,created_at")
    .eq("user_id", user.userId)
    .order("id", { ascending: false })
    .limit(limit);

  if (beforeId > 0) query = query.lt("id", beforeId);

  const { data, error } = await query;
  if (error) return json({ success: false, error: error.message }, 500);

  return json({ success: true, items: data || [] });
}

async function handleMeUsageSummary(req: Request, service: ReturnType<typeof createClient>, user: AuthedUser) {
  const { data: wallet } = await service.from("commerce_wallets").select("current_cycle_id").eq("user_id", user.userId).maybeSingle();
  const cycleId = normalizeText(wallet?.current_cycle_id);

  let query = service
    .from("commerce_ledger")
    .select("tool_code,delta")
    .eq("user_id", user.userId)
    .eq("entry_type", "tool_usage_debit")
    .lt("delta", 0);

  if (cycleId) query = query.eq("cycle_id", cycleId);

  const { data, error } = await query;
  if (error) return json({ success: false, error: error.message }, 500);

  const byTool: Record<string, number> = {};
  let total = 0;
  for (const row of data || []) {
    const tool = normalizeText(row.tool_code) || "unknown";
    const used = Math.abs(Number(row.delta || 0));
    byTool[tool] = (byTool[tool] || 0) + used;
    total += used;
  }

  return json({ success: true, cycle_id: cycleId || null, total_credits_used: total, by_tool: byTool });
}

async function handleToolsExecute(req: Request, service: ReturnType<typeof createClient>, user: AuthedUser) {
  const body = await readJsonBody(req);
  const toolCode = normalizeText(body.tool_code) as ToolCode;
  const requestId = normalizeText(body.request_id) || crypto.randomUUID();
  const idempotencyKey = getIdempotencyKey(req, body);
  const payload = (body.payload && typeof body.payload === "object") ? body.payload as JsonRecord : {};

  if (!idempotencyKey) return json({ success: false, error: "missing_idempotency_key" }, 400);
  if (!toolCode) return json({ success: false, error: "missing_tool_code" }, 400);

  const deviceFingerprintHash = extractDeviceFingerprintHash(req, body);
  const ensureRes = await service.rpc("commerce_ensure_account", { p_user_id: user.userId, p_device_fingerprint_hash: deviceFingerprintHash });
  if (ensureRes.error) return json({ success: false, error: ensureRes.error.message }, 500);

  const payloadHash = await sha256Hex(JSON.stringify(payload));

  const { data: debitData, error: debitError } = await service.rpc("commerce_debit_tool_credits", {
    p_user_id: user.userId,
    p_tool_code: toolCode,
    p_request_id: requestId,
    p_idempotency_key: idempotencyKey,
    p_payload_hash: payloadHash,
  });

  if (debitError) return json({ success: false, error: debitError.message }, 500);

  const debit = (debitData || {}) as any;
  if (!debit.success) {
    const recommendedAction = String(debit.error_code || "") === "INSUFFICIENT_CREDITS" ? "buy_credits" : "contact_support";
    return json({
      success: false,
      error_code: debit.error_code || "TOOL_BLOCKED",
      credits_required: debit.credits_required,
      weekly_wallet_available: debit.weekly_wallet_available || 0,
      free_monthly_available: debit.free_monthly_available || 0,
      extra_wallet_available: debit.extra_wallet_available || 0,
      recommended_action: recommendedAction,
    }, 402);
  }

  const operationId = normalizeText(debit.operation_id);

  if (toolCode === "psd_to_umg" || toolCode === "umg_to_verse") {
    await service.rpc("commerce_mark_usage_attempt_result", {
      p_idempotency_key: idempotencyKey,
      p_status: "success",
      p_upstream_function: "client_local",
      p_upstream_status: 200,
      p_error_code: null,
      p_error_message: null,
    });

    return json({
      success: true,
      operation_id: operationId,
      tool_code: toolCode,
      credit_cost: debit.credit_cost,
      debit_source: debit.debit_source,
      remaining_weekly_available: debit.remaining_weekly_available,
      remaining_free_monthly_available: debit.remaining_free_monthly_available,
      remaining_extra_wallet: debit.remaining_extra_wallet,
      dispatch: "client_local",
    });
  }

  const functionName = TOOL_FUNCTION_MAP[toolCode as keyof typeof TOOL_FUNCTION_MAP];
  if (!functionName) {
    await service.rpc("commerce_mark_usage_attempt_result", {
      p_idempotency_key: idempotencyKey,
      p_status: "failed",
      p_upstream_function: "unknown",
      p_upstream_status: 0,
      p_error_code: "unknown_tool_code",
      p_error_message: "unknown_tool_code",
    });
    return json({ success: false, error: "unknown_tool_code" }, 400);
  }

  const dispatch = await invokeToolFunction({
    functionName,
    userToken: user.token,
    toolCode,
    operationId,
    idempotencyKey,
    userId: user.userId,
    payload,
  });

  if (!dispatch.ok) {
    const errorCode = normalizeText(dispatch.error || "tool_dispatch_failed");
    await service.rpc("commerce_mark_usage_attempt_result", {
      p_idempotency_key: idempotencyKey,
      p_status: "failed",
      p_upstream_function: functionName,
      p_upstream_status: dispatch.status,
      p_error_code: errorCode,
      p_error_message: errorCode,
    });

    if (shouldAutoReverseFailure(dispatch.status, errorCode)) {
      await service.rpc("commerce_reverse_operation", {
        p_user_id: user.userId,
        p_operation_id: operationId,
        p_idempotency_key: `${idempotencyKey}:reverse:auto`,
        p_reason: "auto_reversal_pre_external_cost",
        p_actor_user_id: null,
        p_actor_role: "system",
      });
    }

    return json({
      success: false,
      error: errorCode,
      operation_id: operationId,
      upstream_status: dispatch.status,
      upstream_data: dispatch.data || null,
    }, dispatch.status >= 400 ? dispatch.status : 502);
  }

  await service.rpc("commerce_mark_usage_attempt_result", {
    p_idempotency_key: idempotencyKey,
    p_status: "success",
    p_upstream_function: functionName,
    p_upstream_status: dispatch.status,
    p_error_code: null,
    p_error_message: null,
  });

  return json({
    success: true,
    operation_id: operationId,
    tool_code: toolCode,
    credit_cost: debit.credit_cost,
    debit_source: debit.debit_source,
    remaining_weekly_available: debit.remaining_weekly_available,
    remaining_free_monthly_available: debit.remaining_free_monthly_available,
    remaining_extra_wallet: debit.remaining_extra_wallet,
    tool_result: dispatch.data,
  });
}

async function handleToolsReverse(req: Request, service: ReturnType<typeof createClient>, user: AuthedUser) {
  const body = await readJsonBody(req);
  const operationId = normalizeText(body.operation_id || body.operationId);
  const reason = normalizeText(body.reason) || "manual_reversal";
  const idempotencyKey = getIdempotencyKey(req, body);

  if (!operationId) return json({ success: false, error: "missing_operation_id" }, 400);
  if (!idempotencyKey) return json({ success: false, error: "missing_idempotency_key" }, 400);

  const { data, error } = await service.rpc("commerce_reverse_operation", {
    p_user_id: user.userId,
    p_operation_id: operationId,
    p_idempotency_key: idempotencyKey,
    p_reason: reason,
    p_actor_user_id: user.userId,
    p_actor_role: user.isAdmin ? "admin" : "user",
  });

  if (error) return json({ success: false, error: error.message }, 500);
  return json({ success: true, reversal: data || null });
}

async function handleBillingPacksList(service: ReturnType<typeof createClient>) {
  const { data, error } = await service
    .from("commerce_config")
    .select("config_key,value_json")
    .in("config_key", ["enable_credit_packs", "pack_small_credits", "pack_medium_credits", "pack_large_credits"]);

  if (error) return json({ success: false, error: error.message }, 500);

  const rows = Array.isArray(data) ? data : [];
  const enabled = rows.find((r) => r.config_key === "enable_credit_packs")?.value_json?.value !== false;
  return json({ success: true, enabled, packs: buildPackCatalog(rows as any) });
}

async function handleCatalogToolCosts(service: ReturnType<typeof createClient>) {
  const { data, error } = await service
    .from("commerce_config")
    .select("config_key,value_json")
    .in("config_key", [
      "tool_cost_surprise_gen",
      "tool_cost_edit_studio",
      "tool_cost_camera_control",
      "tool_cost_layer_decomposition",
      "tool_cost_psd_to_umg",
      "tool_cost_umg_to_verse",
    ]);

  if (error) return json({ success: false, error: error.message }, 500);
  return json({ success: true, tool_costs: buildToolCostCatalog(Array.isArray(data) ? (data as any) : []) });
}

async function enforceRateLimit(args: {
  req: Request;
  service: ReturnType<typeof createClient>;
  scope: string;
  user: AuthedUser | null;
  limit: number;
  windowSeconds: number;
}): Promise<Response | null> {
  const enabled = optionalEnv("COMMERCE_RATE_LIMIT_ENABLED").toLowerCase() !== "false";
  if (!enabled) return null;

  const limit = Math.max(1, Math.floor(args.limit));
  const windowSeconds = Math.max(1, Math.floor(args.windowSeconds));
  const subjectKey = args.user?.userId || `ip:${getClientIp(args.req)}`;

  const { data, error } = await args.service.rpc("commerce_check_rate_limit", {
    p_scope: args.scope,
    p_subject_key: subjectKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) return json({ success: false, error: "rate_limit_check_failed" }, 500);

  const payload = (data || {}) as any;
  const allowed = Boolean(payload.allowed);
  if (allowed) return null;

  const retryAfter = Math.max(1, Number(payload.retry_after_seconds || windowSeconds));
  return json(
    {
      success: false,
      error: "rate_limited",
      scope: args.scope,
      retry_after_seconds: retryAfter,
    },
    429,
    { "Retry-After": String(retryAfter) },
  );
}

async function resolveUserIdForSubscriptionEvent(service: ReturnType<typeof createClient>, object: any): Promise<string | null> {
  const metadataUserId = normalizeText(object?.metadata?.user_id);
  if (metadataUserId) return metadataUserId;

  const providerSubscriptionId = normalizeText(object?.subscription || object?.id);
  if (providerSubscriptionId) {
    const bySubscription = await service
      .from("commerce_subscriptions")
      .select("user_id")
      .eq("provider_subscription_id", providerSubscriptionId)
      .maybeSingle();
    const userId = normalizeText(bySubscription.data?.user_id);
    if (userId) return userId;
  }

  const providerCustomerId = normalizeText(object?.customer);
  if (providerCustomerId) {
    const byCustomer = await service
      .from("commerce_subscriptions")
      .select("user_id")
      .eq("provider_customer_id", providerCustomerId)
      .maybeSingle();
    const userId = normalizeText(byCustomer.data?.user_id);
    if (userId) return userId;
  }

  return null;
}

async function upsertStripeSubscriptionState(args: {
  service: ReturnType<typeof createClient>;
  userId: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string;
  snapshot: {
    status: SubscriptionStatus;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  };
  metadata?: Record<string, unknown>;
}) {
  await args.service.from("commerce_subscriptions").upsert({
    user_id: args.userId,
    provider: "stripe",
    provider_customer_id: args.providerCustomerId,
    provider_subscription_id: args.providerSubscriptionId,
    status: args.snapshot.status,
    current_period_start: args.snapshot.current_period_start,
    current_period_end: args.snapshot.current_period_end,
    cancel_at_period_end: args.snapshot.cancel_at_period_end,
    metadata_json: args.metadata || {},
  }, { onConflict: "user_id" });

  if (args.snapshot.status === "active" || args.snapshot.status === "past_due" || args.snapshot.status === "cancel_at_period_end") {
    await args.service.from("commerce_accounts").upsert({
      user_id: args.userId,
      plan_type: "pro",
    }, { onConflict: "user_id" });
  }

  await args.service.rpc("commerce_sync_access_state", { p_user_id: args.userId });
}

async function handleBillingSubscriptionCheckout(req: Request, service: ReturnType<typeof createClient>, user: AuthedUser) {
  const body = await readJsonBody(req);
  const idempotencyKey = getIdempotencyKey(req, body);
  const planCode = normalizeText(body.plan_code || "pro").toLowerCase();
  if (!idempotencyKey) return json({ success: false, error: "missing_idempotency_key" }, 400);
  if (planCode !== "pro") return json({ success: false, error: "unsupported_plan_code" }, 400);

  const priceId = optionalEnv("STRIPE_PRICE_PRO_MONTHLY");
  if (!priceId) return json({ success: false, error: "stripe_price_not_configured" }, 503);

  const appBase = optionalEnv("APP_BASE_URL") || new URL(req.url).origin;
  const successUrl = normalizeText(body.success_url) || `${appBase}/app/billing?checkout=success`;
  const cancelUrl = normalizeText(body.cancel_url) || `${appBase}/app/billing?checkout=cancel`;
  const deviceFingerprintHash = extractDeviceFingerprintHash(req, body);
  const ensureRes = await service.rpc("commerce_ensure_account", { p_user_id: user.userId, p_device_fingerprint_hash: deviceFingerprintHash });
  if (ensureRes.error) return json({ success: false, error: ensureRes.error.message }, 500);

  try {
    const session = await stripeCreateCheckoutSession({
      mode: "subscription",
      priceId,
      customerEmail: user.email,
      successUrl,
      cancelUrl,
      metadata: {
        flow: "subscription",
        plan_code: "pro",
        user_id: user.userId,
        idempotency_key: idempotencyKey,
      },
    });

    return json({ success: true, checkout_url: session.url, checkout_session_id: session.id });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

async function handleBillingPackCheckout(req: Request, service: ReturnType<typeof createClient>, user: AuthedUser, packCode: string) {
  const body = await readJsonBody(req);
  const idempotencyKey = getIdempotencyKey(req, body);
  if (!idempotencyKey) return json({ success: false, error: "missing_idempotency_key" }, 400);

  const configKey = mapPackCodeToConfigKey(packCode);
  if (!configKey) return json({ success: false, error: "unknown_pack_code" }, 404);

  const { data: configRow } = await service.from("commerce_config").select("value_json").eq("config_key", configKey).maybeSingle();
  const credits = Number(configRow?.value_json?.value || 0);
  if (!Number.isFinite(credits) || credits <= 0) return json({ success: false, error: "pack_not_configured" }, 503);

  const priceEnvKey = packCode === "pack_250"
    ? "STRIPE_PRICE_PACK_250"
    : packCode === "pack_650"
      ? "STRIPE_PRICE_PACK_650"
      : "STRIPE_PRICE_PACK_1400";
  const priceId = optionalEnv(priceEnvKey);
  if (!priceId) return json({ success: false, error: "stripe_pack_price_not_configured" }, 503);

  const appBase = optionalEnv("APP_BASE_URL") || new URL(req.url).origin;
  const successUrl = normalizeText(body.success_url) || `${appBase}/app/credits?pack=success`;
  const cancelUrl = normalizeText(body.cancel_url) || `${appBase}/app/credits?pack=cancel`;
  const deviceFingerprintHash = extractDeviceFingerprintHash(req, body);
  const ensureRes = await service.rpc("commerce_ensure_account", { p_user_id: user.userId, p_device_fingerprint_hash: deviceFingerprintHash });
  if (ensureRes.error) return json({ success: false, error: ensureRes.error.message }, 500);

  try {
    const session = await stripeCreateCheckoutSession({
      mode: "payment",
      priceId,
      customerEmail: user.email,
      successUrl,
      cancelUrl,
      metadata: {
        flow: "pack",
        pack_code: packCode,
        user_id: user.userId,
        credits: String(Math.floor(credits)),
        idempotency_key: idempotencyKey,
      },
    });

    await service.from("commerce_pack_purchases").insert({
      user_id: user.userId,
      pack_code: packCode,
      credits: Math.floor(credits),
      provider: "stripe",
      provider_checkout_session_id: session.id,
      status: "pending",
      metadata_json: { idempotency_key: idempotencyKey },
    });

    return json({ success: true, checkout_url: session.url, checkout_session_id: session.id, pack_code: packCode, credits: Math.floor(credits) });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

async function handleWebhook(req: Request, service: ReturnType<typeof createClient>) {
  const rawBody = await req.text();
  const sig = normalizeText(req.headers.get("stripe-signature"));
  const webhookSecret = optionalEnv("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) return json({ success: false, error: "stripe_webhook_secret_not_configured" }, 503);
  const valid = await stripeVerifySignature(rawBody, sig, webhookSecret);
  if (!valid) return json({ success: false, error: "invalid_webhook_signature" }, 401);

  let payload: any;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return json({ success: false, error: "invalid_json_payload" }, 400);
  }

  const eventId = normalizeText(payload?.id);
  const eventType = normalizeText(payload?.type);
  if (!eventId || !eventType) return json({ success: false, error: "missing_event_id_or_type" }, 400);

  const { data: existing } = await service
    .from("commerce_webhook_events")
    .select("id,status")
    .eq("provider_event_id", eventId)
    .maybeSingle();
  if (existing?.id) return json({ success: true, duplicate: true, status: existing.status || "processed" });

  const { data: webhookRow, error: webhookInsertError } = await service
    .from("commerce_webhook_events")
    .insert({
      provider: "stripe",
      provider_event_id: eventId,
      event_type: eventType,
      payload_json: payload,
      status: "received",
    })
    .select("id")
    .single();

  if (webhookInsertError) return json({ success: false, error: webhookInsertError.message }, 500);

  try {
    const object = payload?.data?.object || {};

    if (eventType === "checkout.session.completed") {
      const metadata = object?.metadata || {};
      const flow = normalizeText(metadata.flow);
      const userId = normalizeText(metadata.user_id);

      if (flow === "subscription" && userId) {
        const providerSubscriptionId = normalizeText(object?.subscription);
        let subStatus: SubscriptionStatus = "active";
        let currentPeriodStart: string | null = null;
        let currentPeriodEnd: string | null = null;
        let cancelAtPeriodEnd = false;

        if (providerSubscriptionId) {
          try {
            const details = await stripeFetchSubscriptionDetails(providerSubscriptionId);
            subStatus = details.status;
            currentPeriodStart = details.current_period_start;
            currentPeriodEnd = details.current_period_end;
            cancelAtPeriodEnd = details.cancel_at_period_end;
          } catch {
            // Keep checkout completion robust even if subscription fetch fails.
            subStatus = "active";
          }
        }

        await service.from("commerce_subscriptions").upsert({
          user_id: userId,
          provider: "stripe",
          provider_customer_id: normalizeText(object?.customer),
          provider_subscription_id: providerSubscriptionId || null,
          status: subStatus,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
          cancel_at_period_end: cancelAtPeriodEnd,
          metadata_json: { last_checkout_session_id: normalizeText(object?.id) },
        }, { onConflict: "user_id" });

        await service.from("commerce_accounts").upsert({ user_id: userId, plan_type: "pro", access_state: "pro_active" }, { onConflict: "user_id" });
        await service.rpc("commerce_open_cycle_if_needed", {
          p_user_id: userId,
          p_now: currentPeriodStart || new Date().toISOString(),
          p_idempotency_prefix: "cycle_open_webhook",
        });
        await service.rpc("commerce_sync_access_state", { p_user_id: userId });
      }

      if (flow === "pack" && userId) {
        const packCode = normalizeText(metadata.pack_code);
        const credits = Math.max(1, Number(metadata.credits || 0));
        await service.rpc("commerce_grant_pack_credits", {
          p_user_id: userId,
          p_pack_code: packCode,
          p_credits: credits,
          p_idempotency_key: `stripe:${eventId}:pack_grant`,
          p_reference_id: normalizeText(object?.id),
          p_expires_at: null,
        });

        await service
          .from("commerce_pack_purchases")
          .update({ status: "completed", provider_payment_intent_id: normalizeText(object?.payment_intent) || null, metadata_json: { event_id: eventId } })
          .eq("provider_checkout_session_id", normalizeText(object?.id));
      }
    }

    if (eventType === "invoice.paid" || eventType === "invoice.payment_failed") {
      const userId = await resolveUserIdForSubscriptionEvent(service, object);
      const providerSubscriptionId = normalizeText(object?.subscription);
      if (userId && providerSubscriptionId) {
        let snapshot = buildStripeSubscriptionSnapshot({
          status: eventType === "invoice.payment_failed" ? "past_due" : "active",
          cancel_at_period_end: false,
          current_period_start: null,
          current_period_end: null,
        });
        try {
          snapshot = await stripeFetchSubscriptionDetails(providerSubscriptionId);
        } catch {
          // keep fallback snapshot above
        }
        await upsertStripeSubscriptionState({
          service,
          userId,
          providerCustomerId: normalizeText(object?.customer) || null,
          providerSubscriptionId,
          snapshot,
          metadata: { last_invoice_event: eventType, invoice_id: normalizeText(object?.id) || null },
        });
      }
    }

    if (eventType === "customer.subscription.updated" || eventType === "customer.subscription.deleted") {
      const userId = await resolveUserIdForSubscriptionEvent(service, object);
      const providerSubscriptionId = normalizeText(object?.id);
      if (userId && providerSubscriptionId) {
        const snapshot = eventType === "customer.subscription.deleted"
          ? {
              status: "canceled" as SubscriptionStatus,
              current_period_start: toIsoFromUnix(object?.current_period_start),
              current_period_end: toIsoFromUnix(object?.current_period_end),
              cancel_at_period_end: Boolean(object?.cancel_at_period_end),
            }
          : buildStripeSubscriptionSnapshot(object);

        await upsertStripeSubscriptionState({
          service,
          userId,
          providerCustomerId: normalizeText(object?.customer) || null,
          providerSubscriptionId,
          snapshot,
          metadata: { last_subscription_event: eventType },
        });
      }
    }

    await service.from("commerce_webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", webhookRow.id);
    return json({ success: true, processed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await service.from("commerce_webhook_events").update({ status: "failed", error_text: message }).eq("id", webhookRow.id);
    return json({ success: false, error: message }, 500);
  }
}

async function handleAdminUserOverview(service: ReturnType<typeof createClient>, userId: string) {
  const [accountRes, walletRes, subRes, ledgerRes, attemptsRes, abuseRes] = await Promise.all([
    service.from("commerce_accounts").select("*").eq("user_id", userId).maybeSingle(),
    service.from("commerce_wallets").select("*").eq("user_id", userId).maybeSingle(),
    service.from("commerce_subscriptions").select("*").eq("user_id", userId).maybeSingle(),
    service.from("commerce_ledger").select("*").eq("user_id", userId).order("id", { ascending: false }).limit(100),
    service.from("commerce_tool_usage_attempts").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    service.from("commerce_abuse_signals").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
  ]);

  if (accountRes.error || walletRes.error || subRes.error || ledgerRes.error || attemptsRes.error || abuseRes.error) {
    return json({ success: false, error: "admin_user_query_failed" }, 500);
  }

  return json({
    success: true,
    account: accountRes.data || null,
    wallet: walletRes.data || null,
    subscription: subRes.data || null,
    ledger: ledgerRes.data || [],
    attempts: attemptsRes.data || [],
    abuse_signals: abuseRes.data || [],
  });
}

async function handleAdminCreditAdjust(req: Request, service: ReturnType<typeof createClient>, user: AuthedUser, isGrant: boolean) {
  const body = await readJsonBody(req);
  const targetUserId = normalizeText(body.user_id);
  const walletType = normalizeText(body.wallet_type || "extra_wallet");
  const reason = normalizeText(body.reason);
  const idempotencyKey = getIdempotencyKey(req, body);
  const amount = Math.floor(Number(body.credits || body.amount || 0));

  if (!targetUserId) return json({ success: false, error: "missing_user_id" }, 400);
  if (!reason) return json({ success: false, error: "missing_reason" }, 400);
  if (!idempotencyKey) return json({ success: false, error: "missing_idempotency_key" }, 400);
  if (!Number.isFinite(amount) || amount <= 0) return json({ success: false, error: "invalid_credits" }, 400);

  const delta = isGrant ? amount : -amount;

  const { data, error } = await service.rpc("commerce_admin_adjust_credits", {
    p_user_id: targetUserId,
    p_wallet_type: walletType,
    p_delta: delta,
    p_idempotency_key: idempotencyKey,
    p_reason: reason,
    p_actor_user_id: user.userId,
    p_actor_role: "admin",
    p_reference_id: normalizeText(body.reference_id) || null,
  });

  if (error) return json({ success: false, error: error.message }, 500);
  return json({ success: true, result: data || null });
}

async function handleAdminAbuseReview(req: Request, service: ReturnType<typeof createClient>, admin: AuthedUser, targetUserId: string) {
  const body = await readJsonBody(req);
  const action = normalizeText(body.action || "approve").toLowerCase();
  const reason = normalizeText(body.reason);
  const idempotencyKey = getIdempotencyKey(req, body);
  if (!idempotencyKey) return json({ success: false, error: "missing_idempotency_key" }, 400);

  let patch: Record<string, unknown> = {};
  if (action === "block" || action === "review") {
    patch = {
      anti_abuse_review_required: true,
      anti_abuse_reason: reason || "review_required",
      access_state: "blocked_abuse_review",
    };
  } else {
    patch = {
      anti_abuse_review_required: false,
      anti_abuse_reason: reason || null,
    };
  }

  const { error: updateError } = await service.from("commerce_accounts").update(patch).eq("user_id", targetUserId);
  if (updateError) return json({ success: false, error: updateError.message }, 500);

  await service.from("commerce_abuse_signals").insert({
    user_id: targetUserId,
    signal_type: "admin_review",
    signal_value: action,
    state: "reviewed",
    note: reason || null,
    reviewed_by: admin.userId,
    reviewed_at: new Date().toISOString(),
  });

  if (action === "approve") {
    await service.rpc("commerce_sync_access_state", { p_user_id: targetUserId });
  }

  return json({ success: true, action });
}

async function handleAdminSuspend(req: Request, service: ReturnType<typeof createClient>, targetUserId: string) {
  const body = await readJsonBody(req);
  const suspend = Boolean(body.suspend ?? true);

  if (suspend) {
    const { error } = await service.from("commerce_accounts").update({ access_state: "suspended" }).eq("user_id", targetUserId);
    if (error) return json({ success: false, error: error.message }, 500);
  } else {
    await service.rpc("commerce_sync_access_state", { p_user_id: targetUserId });
  }

  const { data } = await service.from("commerce_accounts").select("*").eq("user_id", targetUserId).maybeSingle();
  return json({ success: true, account: data || null });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const service = createServiceClient();
  const route = pathAfterFunction(req, "commerce");

  try {
    const user = await resolveUser(req, service);

    if (req.method === "GET" && route === "/catalog/tool-costs") {
      return await handleCatalogToolCosts(service);
    }

    if (req.method === "GET" && route === "/me/credits") {
      if (!user) throw new Error("unauthorized");
      return await handleMeCredits(req, service, user);
    }

    if (req.method === "GET" && route === "/me/credits/summary") {
      if (!user) throw new Error("unauthorized");
      return await handleMeCreditsSummary(req, service, user);
    }

    if (req.method === "GET" && route === "/me/ledger") {
      if (!user) throw new Error("unauthorized");
      return await handleMeLedger(req, service, user);
    }

    if (req.method === "GET" && route === "/me/usage-summary") {
      if (!user) throw new Error("unauthorized");
      return await handleMeUsageSummary(req, service, user);
    }

    if (req.method === "POST" && route === "/tools/execute") {
      if (!user) throw new Error("unauthorized");
      const limited = await enforceRateLimit({
        req,
        service,
        scope: "tools_execute",
        user,
        limit: envInt("COMMERCE_RATE_LIMIT_EXECUTE_PER_MINUTE", 24, 1, 500),
        windowSeconds: 60,
      });
      if (limited) return limited;
      return await handleToolsExecute(req, service, user);
    }

    if (req.method === "POST" && route === "/tools/reverse") {
      if (!user) throw new Error("unauthorized");
      const limited = await enforceRateLimit({
        req,
        service,
        scope: "tools_reverse",
        user,
        limit: envInt("COMMERCE_RATE_LIMIT_REVERSE_PER_MINUTE", 30, 1, 500),
        windowSeconds: 60,
      });
      if (limited) return limited;
      return await handleToolsReverse(req, service, user);
    }

    if (req.method === "POST" && route === "/billing/subscription/checkout") {
      if (!user) throw new Error("unauthorized");
      const limited = await enforceRateLimit({
        req,
        service,
        scope: "billing_subscription_checkout",
        user,
        limit: envInt("COMMERCE_RATE_LIMIT_SUB_CHECKOUT_PER_HOUR", 6, 1, 100),
        windowSeconds: 3600,
      });
      if (limited) return limited;
      return await handleBillingSubscriptionCheckout(req, service, user);
    }

    if (req.method === "GET" && route === "/billing/packs") {
      if (!user) throw new Error("unauthorized");
      return await handleBillingPacksList(service);
    }

    if (req.method === "POST" && route.startsWith("/billing/packs/") && route.endsWith("/checkout")) {
      if (!user) throw new Error("unauthorized");
      const limited = await enforceRateLimit({
        req,
        service,
        scope: "billing_pack_checkout",
        user,
        limit: envInt("COMMERCE_RATE_LIMIT_PACK_CHECKOUT_PER_HOUR", 12, 1, 200),
        windowSeconds: 3600,
      });
      if (limited) return limited;
      const packCode = normalizeText(route.split("/")[3]);
      return await handleBillingPackCheckout(req, service, user, packCode);
    }

    if (req.method === "POST" && route === "/billing/webhooks/provider") {
      const limited = await enforceRateLimit({
        req,
        service,
        scope: "billing_webhook_provider",
        user: null,
        limit: envInt("COMMERCE_RATE_LIMIT_WEBHOOK_PER_MINUTE", 240, 10, 2000),
        windowSeconds: 60,
      });
      if (limited) return limited;
      return await handleWebhook(req, service);
    }

    if (req.method === "GET" && route.startsWith("/admin/user/")) {
      if (!user) throw new Error("unauthorized");
      requireFinancialAdmin(user);
      const targetUserId = normalizeText(route.split("/")[3]);
      return await handleAdminUserOverview(service, targetUserId);
    }

    if (req.method === "POST" && route === "/admin/credits/grant") {
      if (!user) throw new Error("unauthorized");
      requireFinancialAdmin(user);
      return await handleAdminCreditAdjust(req, service, user, true);
    }

    if (req.method === "POST" && route === "/admin/credits/debit") {
      if (!user) throw new Error("unauthorized");
      requireFinancialAdmin(user);
      return await handleAdminCreditAdjust(req, service, user, false);
    }

    if (req.method === "POST" && route.startsWith("/admin/user/") && route.endsWith("/abuse-review")) {
      if (!user) throw new Error("unauthorized");
      requireFinancialAdmin(user);
      const targetUserId = normalizeText(route.split("/")[3]);
      return await handleAdminAbuseReview(req, service, user, targetUserId);
    }

    if (req.method === "POST" && route.startsWith("/admin/user/") && route.endsWith("/suspend")) {
      if (!user) throw new Error("unauthorized");
      requireFinancialAdmin(user);
      const targetUserId = normalizeText(route.split("/")[3]);
      return await handleAdminSuspend(req, service, targetUserId);
    }

    if (req.method === "POST" && route === "/internal/jobs/weekly-release") {
      requireInternalOrAdmin(req, user);
      const { data, error } = await service.rpc("commerce_weekly_release_job", { p_now: new Date().toISOString(), p_limit: 1000 });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, result: data || null });
    }

    if (req.method === "POST" && route === "/internal/jobs/reconcile") {
      requireInternalOrAdmin(req, user);
      const body = await readJsonBody(req);
      const limit = Math.max(1, Math.min(5000, Math.floor(Number(body.limit || 1000))));
      const { data, error } = await service.rpc("commerce_reconcile_job", { p_limit: limit });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, result: data || null });
    }

    return json({ success: false, error: "not_found", route }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "unauthorized"
      ? 401
      : message === "forbidden"
        ? 403
        : message.includes("stripe")
          ? 502
          : 500;
    return json({ success: false, error: message }, status);
  }
});
