import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPIC_ACCOUNT_OAUTH_TOKEN = "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token";
const EPIC_LINKS_MNEMONIC_BASE = "https://links-public-service-live.ol.epicgames.com/links/api/fn/mnemonic";

const ISLAND_CODE_RE = /^\d{4}-\d{4}-\d{4}$/;

type Mode = "orchestrate" | "refresh_link_codes" | "config_status";

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mustEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function hasEnv(key: string): boolean {
  const v = Deno.env.get(key);
  return Boolean(v && String(v).trim().length > 0);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json: any; headers: Headers }> {
  const timeoutMs = init.timeoutMs ?? 20000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: res.ok, status: res.status, json: body, headers: res.headers };
  } finally {
    clearTimeout(t);
  }
}

function epicCorrelationIdFromHeaders(h: Headers): string | null {
  return h.get("x-epic-correlation-id") || h.get("X-Epic-Correlation-Id");
}

async function getEg1Token(): Promise<{ accountId: string; accessToken: string }> {
  const clientId = mustEnv("EPIC_OAUTH_CLIENT_ID");
  const clientSecret = mustEnv("EPIC_OAUTH_CLIENT_SECRET");
  const deviceAccountId = mustEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID");
  const deviceId = mustEnv("EPIC_DEVICE_AUTH_DEVICE_ID");
  const deviceSecret = mustEnv("EPIC_DEVICE_AUTH_SECRET");

  const basic = btoa(`${clientId}:${clientSecret}`);
  const form = new URLSearchParams();
  form.set("grant_type", "device_auth");
  form.set("account_id", deviceAccountId);
  form.set("device_id", deviceId);
  form.set("secret", deviceSecret);
  form.set("token_type", "eg1");

  const res = await fetchJson(EPIC_ACCOUNT_OAUTH_TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    timeoutMs: 20000,
  });
  if (!res.ok) {
    const msg = res.json?.errorMessage || res.json?.error || `HTTP ${res.status}`;
    throw new Error(`Epic OAuth device_auth failed: ${msg}`);
  }
  const accessToken = String(res.json?.access_token || "");
  const accountId = String(res.json?.account_id || deviceAccountId);
  if (!accessToken) throw new Error("Epic OAuth returned empty access_token");
  return { accountId, accessToken };
}

function extractFields(payload: any) {
  const top = payload || {};
  const m = top.metadata || {};
  const mmv2 = m.matchmakingV2 || {};
  const ratings = m.ratings || null;

  const imageUrls = m.image_urls || m.imageUrls || null;
  const extraImages = m.extra_image_urls || m.extraImageUrls || null;

  return {
    namespace: top.namespace ?? null,
    linkType: top.linkType ?? null,
    accountId: top.accountId ?? null,
    creatorName: top.creatorName ?? null,
    supportCode: m.supportCode ?? null,
    title: m.title ?? null,
    tagline: m.tagline ?? null,
    introduction: m.introduction ?? null,
    locale: m.locale ?? null,
    imageUrl: m.image_url ?? m.imageUrl ?? null,
    imageUrls,
    extraImageUrls: extraImages,
    videoVuid: m.video_vuid ?? m.videoVuid ?? null,
    maxPlayers: mmv2.maxPlayers ?? null,
    minPlayers: mmv2.minPlayers ?? null,
    maxSocialPartySize: mmv2.maxSocialPartySize ?? null,
    ratings,
    version: top.version ?? null,
    createdAtEpic: top.created ?? null,
    publishedAtEpic: top.published ?? null,
    updatedAtEpic: top.updated ?? null,
    lastActivatedAtEpic: top.lastActivatedDate ?? null,
    moderationStatus: top.moderationStatus ?? null,
    linkState: top.linkState ?? null,
    discoveryIntent: top.discoveryIntent ?? null,
    active: top.active ?? null,
    disabled: top.disabled ?? null,
  };
}

function nextDueFromSignals(args: { isPremiumNow: boolean; lastSeenAt: string | null; now: Date }): Date {
  const { isPremiumNow, lastSeenAt, now } = args;
  if (isPremiumNow) return new Date(now.getTime() + 60 * 60 * 1000);
  if (lastSeenAt) {
    const ls = new Date(lastSeenAt).getTime();
    if (isFinite(ls) && ls >= now.getTime() - 24 * 60 * 60 * 1000) {
      return new Date(now.getTime() + 6 * 60 * 60 * 1000);
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

function backoffNextDue(now: Date, status: number, prevError: string | null): Date {
  // Simple conservative backoff; we don't track attempt counts yet.
  const baseMin = status === 429 ? 15 : 10;
  const bump = prevError ? 15 : 0;
  return new Date(now.getTime() + (baseMin + bump) * 60 * 1000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const mode = String(body.mode || "orchestrate") as Mode;

    if (mode === "config_status") {
      const cfgOk = hasEnv("EPIC_OAUTH_CLIENT_ID") &&
        hasEnv("EPIC_OAUTH_CLIENT_SECRET") &&
        hasEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID") &&
        hasEnv("EPIC_DEVICE_AUTH_DEVICE_ID") &&
        hasEnv("EPIC_DEVICE_AUTH_SECRET");
      return json({
        success: true,
        configured: cfgOk,
        missing: [
          !hasEnv("EPIC_OAUTH_CLIENT_ID") ? "EPIC_OAUTH_CLIENT_ID" : null,
          !hasEnv("EPIC_OAUTH_CLIENT_SECRET") ? "EPIC_OAUTH_CLIENT_SECRET" : null,
          !hasEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID") ? "EPIC_DEVICE_AUTH_ACCOUNT_ID" : null,
          !hasEnv("EPIC_DEVICE_AUTH_DEVICE_ID") ? "EPIC_DEVICE_AUTH_DEVICE_ID" : null,
          !hasEnv("EPIC_DEVICE_AUTH_SECRET") ? "EPIC_DEVICE_AUTH_SECRET" : null,
        ].filter(Boolean),
      });
    }

    if (mode === "refresh_link_codes") {
      const linkCodes = Array.isArray(body.linkCodes) ? body.linkCodes.map((x: any) => String(x)) : [];
      if (!linkCodes.length) return json({ success: false, error: "Missing linkCodes[]" }, 400);
      const dueWithinMinutesRaw = body.dueWithinMinutes != null ? Number(body.dueWithinMinutes) : 0;
      const dueWithinMinutes = isFinite(dueWithinMinutesRaw) ? Math.max(0, Math.min(24 * 60, dueWithinMinutesRaw)) : 0;

      const { data, error } = await supabase.rpc("enqueue_discover_link_metadata", {
        p_link_codes: linkCodes,
        p_due_within_minutes: dueWithinMinutes,
      });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, mode, enqueued: data, submitted: linkCodes.length, dueWithinMinutes });
    }

    // mode=orchestrate
    const cfgOk = hasEnv("EPIC_OAUTH_CLIENT_ID") &&
      hasEnv("EPIC_OAUTH_CLIENT_SECRET") &&
      hasEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID") &&
      hasEnv("EPIC_DEVICE_AUTH_DEVICE_ID") &&
      hasEnv("EPIC_DEVICE_AUTH_SECRET");
    if (!cfgOk) {
      return json({
        success: true,
        mode,
        claimed: false,
        configured: false,
        missing: [
          !hasEnv("EPIC_OAUTH_CLIENT_ID") ? "EPIC_OAUTH_CLIENT_ID" : null,
          !hasEnv("EPIC_OAUTH_CLIENT_SECRET") ? "EPIC_OAUTH_CLIENT_SECRET" : null,
          !hasEnv("EPIC_DEVICE_AUTH_ACCOUNT_ID") ? "EPIC_DEVICE_AUTH_ACCOUNT_ID" : null,
          !hasEnv("EPIC_DEVICE_AUTH_DEVICE_ID") ? "EPIC_DEVICE_AUTH_DEVICE_ID" : null,
          !hasEnv("EPIC_DEVICE_AUTH_SECRET") ? "EPIC_DEVICE_AUTH_SECRET" : null,
        ].filter(Boolean),
      });
    }

    const budgetMs = Number(body.budgetMs ?? 45_000);
    const maxItems = Math.min(1000, Math.max(1, Number(body.maxItems ?? 500)));

    const startedAt = Date.now();
    const now = new Date();

    const { data: claims, error: claimErr } = await supabase.rpc("claim_discover_link_metadata", {
      p_take: maxItems,
      p_stale_after_seconds: 180,
    });
    if (claimErr) return json({ success: false, error: claimErr.message }, 500);
    const claimed = Array.isArray(claims) ? claims : [];
    if (!claimed.length) return json({ success: true, mode, claimed: false, processed: 0 });

    const lockByCode = new Map<string, string>();
    const codes = claimed.map((c: any) => String(c.link_code));
    for (const c of claimed) lockByCode.set(String(c.link_code), String(c.lock_id));

    // Fetch current rows for diff/events and existing last_error
    const existingMap = new Map<string, any>();
    for (let i = 0; i < codes.length; i += 1000) {
      const chunk = codes.slice(i, i + 1000);
      const { data, error } = await supabase
        .from("discover_link_metadata")
        .select("link_code,title,image_url,updated_at_epic,moderation_status,link_state,last_error")
        .in("link_code", chunk);
      if (error) return json({ success: false, error: error.message }, 500);
      for (const r of data || []) existingMap.set(String(r.link_code), r);
    }

    // Signals for next_due_at
    const premiumNow = new Set<string>();
    {
      const { data, error } = await supabase
        .from("discovery_exposure_rank_segments")
        .select("link_code,panel_name,end_ts")
        .in("link_code", codes)
        .is("end_ts", null)
        .limit(5000);
      if (!error) {
        const panelNames = Array.from(new Set((data || []).map((r: any) => String(r.panel_name))));
        // Only treat tier1 panels as premium (lookup once)
        const { data: tiers } = await supabase
          .from("discovery_panel_tiers")
          .select("panel_name,tier")
          .in("panel_name", panelNames);
        const tier1 = new Set((tiers || []).filter((t: any) => Number(t.tier) === 1).map((t: any) => String(t.panel_name)));
        for (const r of data || []) {
          if (tier1.has(String(r.panel_name))) premiumNow.add(String(r.link_code));
        }
      }
    }

    const lastSeenMap = new Map<string, string>();
    {
      const { data, error } = await supabase
        .from("discovery_exposure_link_state")
        .select("link_code,last_seen_at")
        .in("link_code", codes)
        .order("last_seen_at", { ascending: false })
        .limit(20000);
      if (!error) {
        for (const r of data || []) {
          const code = String(r.link_code);
          if (!lastSeenMap.has(code)) lastSeenMap.set(code, String(r.last_seen_at));
        }
      }
    }

    const auth = await getEg1Token();

    const updates: any[] = [];
    const events: any[] = [];
    const results: any[] = [];

    for (const code of codes) {
      if (Date.now() - startedAt > budgetMs - 1500) break;

      const prev = existingMap.get(code) || {};
      const prevError = prev.last_error ? String(prev.last_error) : null;

      const url = `${EPIC_LINKS_MNEMONIC_BASE}/${encodeURIComponent(code)}`;
      const res = await fetchJson(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          Accept: "application/json",
        },
        timeoutMs: 20000,
      });

      const correlationId = epicCorrelationIdFromHeaders(res.headers);
      const linkCodeType = ISLAND_CODE_RE.test(code) ? "island" : "collection";

      if (!res.ok) {
        const err = res.json?.errorMessage || res.json?.detail || res.json?.error || `HTTP ${res.status}`;
        const nextDue = backoffNextDue(now, res.status, prevError).toISOString();
        updates.push({
          link_code: code,
          link_code_type: linkCodeType,
          last_fetched_at: now.toISOString(),
          next_due_at: nextDue,
          last_error: String(err),
          locked_at: null,
          lock_id: null,
          updated_at: now.toISOString(),
        });
        results.push({ linkCode: code, ok: false, status: res.status, correlationId, error: String(err) });
        continue;
      }

      const p = res.json;
      const f = extractFields(p);
      const nextDue = nextDueFromSignals({
        isPremiumNow: premiumNow.has(code),
        lastSeenAt: lastSeenMap.get(code) || null,
        now,
      }).toISOString();

      // Events
      const prevTitle = prev.title != null ? String(prev.title) : null;
      const prevImage = prev.image_url != null ? String(prev.image_url) : null;
      const prevUpdated = prev.updated_at_epic != null ? String(prev.updated_at_epic) : null;
      const prevMod = prev.moderation_status != null ? String(prev.moderation_status) : null;
      const prevState = prev.link_state != null ? String(prev.link_state) : null;

      if (prevImage && f.imageUrl && prevImage !== String(f.imageUrl)) {
        events.push({ link_code: code, event_type: "thumb_changed", old_value: { image_url: prevImage }, new_value: { image_url: f.imageUrl } });
      }
      if (prevTitle && f.title && prevTitle !== String(f.title)) {
        events.push({ link_code: code, event_type: "title_changed", old_value: { title: prevTitle }, new_value: { title: f.title } });
      }
      if (prevUpdated && f.updatedAtEpic && prevUpdated !== String(f.updatedAtEpic)) {
        events.push({ link_code: code, event_type: "epic_updated", old_value: { updated: prevUpdated }, new_value: { updated: f.updatedAtEpic } });
      }
      if ((prevMod && f.moderationStatus && prevMod !== String(f.moderationStatus)) || (prevState && f.linkState && prevState !== String(f.linkState))) {
        events.push({
          link_code: code,
          event_type: "moderation_changed",
          old_value: { moderation_status: prevMod, link_state: prevState },
          new_value: { moderation_status: f.moderationStatus, link_state: f.linkState },
        });
      }

      updates.push({
        link_code: code,
        link_code_type: linkCodeType,
        namespace: f.namespace,
        link_type: f.linkType,
        account_id: f.accountId,
        creator_name: f.creatorName,
        support_code: f.supportCode,
        title: f.title,
        tagline: f.tagline,
        introduction: f.introduction,
        locale: f.locale,
        image_url: f.imageUrl,
        image_urls: f.imageUrls,
        extra_image_urls: f.extraImageUrls,
        video_vuid: f.videoVuid,
        max_players: f.maxPlayers,
        min_players: f.minPlayers,
        max_social_party_size: f.maxSocialPartySize,
        ratings: f.ratings,
        version: f.version,
        created_at_epic: f.createdAtEpic,
        published_at_epic: f.publishedAtEpic,
        updated_at_epic: f.updatedAtEpic,
        last_activated_at_epic: f.lastActivatedAtEpic,
        moderation_status: f.moderationStatus,
        link_state: f.linkState,
        discovery_intent: f.discoveryIntent,
        active: f.active,
        disabled: f.disabled,
        last_fetched_at: now.toISOString(),
        next_due_at: nextDue,
        last_error: null,
        locked_at: null,
        lock_id: null,
        // V1: do not persist full RAW payload permanently.
        raw: {},
        updated_at: now.toISOString(),
      });

      results.push({ linkCode: code, ok: true, status: 200, correlationId, premiumNow: premiumNow.has(code) });

      // Write-back (islands only) for legacy cache consumers (best-effort).
      if (linkCodeType === "island") {
        try {
          await supabase
            .from("discover_islands_cache")
            .update({
              image_url: f.imageUrl,
              published_at_epic: f.publishedAtEpic,
              updated_at_epic: f.updatedAtEpic,
              moderation_status: f.moderationStatus,
              link_state: f.linkState,
              max_players: f.maxPlayers,
              min_players: f.minPlayers,
              last_metadata_fetch_at: now.toISOString(),
            })
            .eq("island_code", code);
        } catch (_e) {
          // ignore
        }
      }

      // Be nice to the upstream.
      await sleep(25);
    }

    // Write events then upsert metadata
    if (events.length) {
      for (let i = 0; i < events.length; i += 500) {
        await supabase.from("discover_link_metadata_events").insert(events.slice(i, i + 500));
      }
    }
    for (let i = 0; i < updates.length; i += 200) {
      const chunk = updates.slice(i, i + 200);
      const { error } = await supabase.from("discover_link_metadata").upsert(chunk, { onConflict: "link_code" });
      if (error) return json({ success: false, error: error.message }, 500);
    }

    return json({
      success: true,
      mode,
      claimed: true,
      processed: updates.length,
      events: events.length,
      duration_ms: Date.now() - startedAt,
      sample: results.slice(0, 10),
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
