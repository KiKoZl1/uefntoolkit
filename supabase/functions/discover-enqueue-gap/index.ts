import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  dataBridgeUnavailableResponse,
  dataProxyResponse,
  getEnvNumber,
  invokeDataFunction,
  shouldBlockLocalExecution,
  shouldProxyToData,
} from "../_shared/dataBridge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isServiceRoleRequest(req: Request, serviceKey: string): boolean {
  const authHeader = (req.headers.get("Authorization") || "").trim();
  const apiKeyHeader = (req.headers.get("apikey") || "").trim();
  const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader;

  const isServiceRoleJwt = (token: string): boolean => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return false;
      let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4;
      if (pad) b64 += "=".repeat(4 - pad);
      const payload = JSON.parse(atob(b64));
      return payload?.role === "service_role";
    } catch {
      return false;
    }
  };

  if (serviceKey && (
    authHeader === `Bearer ${serviceKey}` ||
    authHeader === serviceKey ||
    apiKeyHeader === serviceKey
  )) return true;

  return isServiceRoleJwt(authToken) || isServiceRoleJwt(apiKeyHeader);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (shouldProxyToData(req)) {
      const proxied = await invokeDataFunction({
        req,
        functionName: "discover-enqueue-gap",
        body,
        timeoutMs: getEnvNumber("LOOKUP_DATA_TIMEOUT_MS", 6000),
      });
      if (proxied.ok) return dataProxyResponse(proxied.data, proxied.status, corsHeaders);
      return dataBridgeUnavailableResponse(corsHeaders, proxied.error);
    }

    if (shouldBlockLocalExecution(req)) {
      return dataBridgeUnavailableResponse(corsHeaders, "strict proxy mode");
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    // Dual auth: accept service_role key OR admin/editor JWT
    const authHeader = (req.headers.get("Authorization") || "").trim();
    if (isServiceRoleRequest(req, serviceKey)) {
      // service_role — OK
    } else {
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: u, error: uErr } = await supabase.auth.getUser(token);
      if (uErr || !u?.user?.id) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roles } = await supabase
        .from("user_roles").select("role").eq("user_id", u.user.id)
        .in("role", ["admin", "editor"]).limit(1);
      if (!roles || roles.length === 0) {
        return new Response(JSON.stringify({ error: "Forbidden: admin/editor required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Parse optional maxIslands from body (default: 50000 per invocation)
    let maxIslands = 50_000;
    if (body?.maxIslands) maxIslands = Math.max(1000, Number(body.maxIslands));

    // Collect islands from cache in pages of 1000 up to maxIslands
    const codes: string[] = [];
    let offset = 0;
    const PAGE = 1000;
    const startMs = Date.now();
    const BUDGET_MS = 25_000; // leave headroom for RPC calls

    while (codes.length < maxIslands) {
      if (Date.now() - startMs > BUDGET_MS) break; // time guard

      const { data, error } = await supabase
        .from("discover_islands_cache")
        .select("island_code")
        .order("last_week_plays", { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE - 1);

      if (error) throw error;
      if (!data?.length) break;
      codes.push(...data.map((d: { island_code: string }) => d.island_code));
      if (data.length < PAGE) break;
      offset += PAGE;
    }

    if (codes.length === 0) {
      return new Response(
        JSON.stringify({ success: true, submitted: 0, inserted: 0, updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enqueue via RPC in chunks
    let totalInserted = 0;
    let totalUpdated = 0;
    const CHUNK = 5000;
    for (let i = 0; i < codes.length; i += CHUNK) {
      if (Date.now() - startMs > 50_000) break; // hard time guard
      const chunk = codes.slice(i, i + CHUNK);
      const { data: enq, error: rpcError } = await supabase.rpc(
        "enqueue_discover_link_metadata",
        { p_link_codes: chunk, p_due_within_minutes: 0 }
      );
      if (rpcError) throw rpcError;
      if (enq) {
        totalInserted += Number(enq.inserted || 0);
        totalUpdated += Number(enq.updated || 0);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        submitted: codes.length,
        inserted: totalInserted,
        updated: totalUpdated,
        elapsed_ms: Date.now() - startMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
