const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_PROXY_ERROR = "DATA_BRIDGE_UNAVAILABLE";
const OWNER_HEADER_KEY = "x-backend-owner";
const OWNER_HEADER_VALUE = "data";

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value || !String(value).trim()) {
    throw new Error(`Missing env var: ${name}`);
  }
  return String(value).trim();
}

export function getEnvNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function getEnvBool(name: string, fallback: boolean): boolean {
  const raw = String(Deno.env.get(name) || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

export function isInternalBridgeRequest(req: Request): boolean {
  const secret = Deno.env.get("INTERNAL_BRIDGE_SECRET");
  if (!secret) return false;
  const incoming = req.headers.get("x-internal-bridge-secret") || "";
  return Boolean(incoming) && incoming === secret;
}

export function shouldProxyToData(req: Request): boolean {
  const srcUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
  const dataUrl = String(Deno.env.get("DATA_SUPABASE_URL") || "").trim();
  const dataKey = String(Deno.env.get("DATA_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const bridgeSecret = String(Deno.env.get("INTERNAL_BRIDGE_SECRET") || "").trim();
  const hop = String(req.headers.get("x-bridge-hop") || "");

  if (!srcUrl || !dataUrl) return false;
  if (!dataKey || !bridgeSecret) return false;
  if (dataUrl === srcUrl) return false;
  if (hop === "1") return false;
  if (isInternalBridgeRequest(req)) return false;
  return true;
}

export function isDataSplitConfigured(): boolean {
  const srcUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
  const dataUrl = String(Deno.env.get("DATA_SUPABASE_URL") || "").trim();
  const dataKey = String(Deno.env.get("DATA_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const bridgeSecret = String(Deno.env.get("INTERNAL_BRIDGE_SECRET") || "").trim();
  if (!srcUrl || !dataUrl || !dataKey || !bridgeSecret) return false;
  return dataUrl !== srcUrl;
}

function isDataSplitIntentEnabled(): boolean {
  const srcUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
  const dataUrl = String(Deno.env.get("DATA_SUPABASE_URL") || "").trim();
  if (!srcUrl || !dataUrl) return false;
  return dataUrl !== srcUrl;
}

export function isStrictDataProxyEnabled(): boolean {
  // Default strict so App never silently falls back to local discovery/dppi paths.
  return getEnvBool("DISCOVERY_DPPI_PROXY_STRICT", true);
}

export function shouldBlockLocalExecution(req: Request): boolean {
  if (!isStrictDataProxyEnabled()) return false;
  // Fail-closed on App whenever split intent is enabled (DATA_SUPABASE_URL != SUPABASE_URL),
  // even if bridge credentials are missing/invalid.
  if (!isDataSplitIntentEnabled()) return false;
  if (isInternalBridgeRequest(req)) return false;
  if (String(req.headers.get("x-bridge-hop") || "") === "1") return false;
  return !shouldProxyToData(req);
}

type InvokeDataFnArgs = {
  req: Request;
  functionName: string;
  body: unknown;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
};

type InvokeDataFnResult = {
  ok: boolean;
  status: number;
  data: any;
  error?: string;
  bridgeMs: number;
  upstreamServerTiming?: string | null;
};

export async function invokeDataFunction(args: InvokeDataFnArgs): Promise<InvokeDataFnResult> {
  const { req, functionName, body } = args;
  const timeoutMs = Math.max(500, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const extraHeaders = args.extraHeaders || {};
  const startedAt = Date.now();

  const dataUrl = env("DATA_SUPABASE_URL");
  const dataKey = env("DATA_SUPABASE_SERVICE_ROLE_KEY");
  const bridgeSecret = env("INTERNAL_BRIDGE_SECRET");
  const url = `${dataUrl.replace(/\/+$/, "")}/functions/v1/${encodeURIComponent(functionName)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${dataKey}`,
        "apikey": dataKey,
        "x-internal-bridge-secret": bridgeSecret,
        "x-bridge-hop": "1",
        // Forward user token for traceability/auditing only; data-side auth can ignore.
        "x-forwarded-authorization": authHeader,
        ...extraHeaders,
      },
      body: JSON.stringify(body ?? {}),
    });

    const rawText = await response.text();
    let parsed: any = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = { raw: rawText };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: parsed,
        error: parsed?.error || `Data function ${functionName} failed (${response.status})`,
        bridgeMs: Date.now() - startedAt,
        upstreamServerTiming: response.headers.get("server-timing"),
      };
    }

    return {
      ok: true,
      status: response.status,
      data: parsed,
      bridgeMs: Date.now() - startedAt,
      upstreamServerTiming: response.headers.get("server-timing"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 502, data: null, error: message, bridgeMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

function mergeServerTiming(base: string | null, bridgeMs?: number): string | null {
  const parts: string[] = [];
  const normalizedBase = String(base || "").trim();
  if (normalizedBase) parts.push(normalizedBase);
  if (typeof bridgeMs === "number" && Number.isFinite(bridgeMs) && bridgeMs >= 0) {
    parts.push(`bridge;dur=${bridgeMs.toFixed(1)}`);
  }
  if (!parts.length) return null;
  return parts.join(", ");
}

export function dataOwnerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    [OWNER_HEADER_KEY]: OWNER_HEADER_VALUE,
    ...extra,
  };
}

export function dataProxyResponse(payload: unknown, status: number, baseHeaders: Record<string, string> = {}): Response {
  const mergedServerTiming = mergeServerTiming(
    baseHeaders["Server-Timing"] || baseHeaders["server-timing"] || null,
    payload && typeof payload === "object" && "bridgeMs" in (payload as any)
      ? Number((payload as any).bridgeMs)
      : undefined,
  );
  const headers: Record<string, string> = {
    ...baseHeaders,
    "Content-Type": "application/json",
    ...dataOwnerHeaders(),
  };
  if (mergedServerTiming) headers["Server-Timing"] = mergedServerTiming;

  return new Response(JSON.stringify(payload ?? {}), {
    status,
    headers,
  });
}

export function dataBridgeUnavailableResponse(baseHeaders: Record<string, string> = {}, detail?: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: DEFAULT_PROXY_ERROR,
      code: DEFAULT_PROXY_ERROR,
      detail: detail || "Data backend unavailable",
    }),
    {
      status: 503,
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json",
        ...dataOwnerHeaders(),
      },
    },
  );
}
