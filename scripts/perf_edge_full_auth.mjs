import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(cwd = process.cwd()) {
  const out = { ...process.env };
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) return out;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const k = trimmed.slice(0, idx).trim();
    const vRaw = trimmed.slice(idx + 1).trim();
    const v = vRaw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!out[k]) out[k] = v;
  }
  return out;
}

function must(env, key) {
  const v = String(env[key] || "").trim();
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function projectRefFromUrl(url) {
  const host = new URL(url).hostname;
  return host.split(".")[0] || "";
}

async function listFunctions(projectRef, accessToken) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/functions`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`listFunctions ${projectRef} failed: HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

async function ensureAdminSession(env) {
  const appUrl = must(env, "VITE_SUPABASE_URL");
  const publishableKey = must(env, "VITE_SUPABASE_PUBLISHABLE_KEY");
  const serviceRole = must(env, "SUPABASE_SERVICE_ROLE_KEY");
  const email = String(env.PERF_ADMIN_EMAIL || "perf-admin@epic-insight.local").trim();
  const password = String(env.PERF_ADMIN_PASSWORD || "PerfAdmin#2026!").trim();

  const service = createClient(appUrl, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
  const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) throw users.error;
  let userId = users.data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase())?.id;
  if (!userId) {
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Perf Admin" },
    });
    if (created.error) throw created.error;
    userId = created.data.user?.id;
  } else {
    const updated = await service.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { display_name: "Perf Admin" },
    });
    if (updated.error) throw updated.error;
  }
  if (!userId) throw new Error("Unable to resolve perf admin user id");

  const del = await service.from("user_roles").delete().eq("user_id", userId);
  if (del.error) throw del.error;
  const ins = await service.from("user_roles").insert({ user_id: userId, role: "admin" });
  if (ins.error) throw ins.error;

  const anon = createClient(appUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const login = await anon.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const accessToken = login.data.session?.access_token || "";
  if (!accessToken) throw new Error("Unable to obtain admin access token");

  return { email, userId, accessToken };
}

const PAYLOADS = {
  "discover-data-api": { method: "POST", body: { action: "overview" } },
  "discover-island-lookup": { method: "POST", body: { islandCode: "1653-3577-0370" } },
  "discover-island-page": { method: "POST", body: { islandCode: "1653-3577-0370" } },
  "discover-panel-timeline": { method: "POST", body: { days: 7 } },
  "discover-rails-resolver": { method: "POST", body: { islandCode: "1653-3577-0370" } },
  "discover-panel-intel-refresh": { method: "POST", body: { force: false } },
  "discover-cron-admin": { method: "POST", body: { action: "status" } },
  "dppi-worker-heartbeat": { method: "POST", body: { worker_id: "perf-probe" } },
  "dppi-health": { method: "POST", body: {} },
  "tgis-health": { method: "POST", body: {} },
};

function payloadFor(endpoint) {
  return PAYLOADS[endpoint] || { method: "POST", body: {} };
}

async function probeOne({ target, ref, endpoint, headersBase, timeoutMs }) {
  const p = payloadFor(endpoint);
  const headers = { ...headersBase, "Content-Type": "application/json" };
  const url = `https://${ref}.supabase.co/functions/v1/${endpoint}`;

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: p.method,
      headers,
      body: p.method === "GET" ? undefined : JSON.stringify(p.body || {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return {
      target,
      endpoint,
      status: null,
      ms: Date.now() - t0,
      ok: false,
      owner: null,
      error: String(e?.message || e),
    };
  }

  const ms = Date.now() - t0;
  const owner = res.headers.get("x-backend-owner");
  let error = null;
  if (!res.ok) {
    try {
      const j = await res.json();
      error = j?.code || j?.error || j?.message || JSON.stringify(j);
    } catch {
      try {
        const txt = await res.text();
        error = txt.slice(0, 200) || `HTTP ${res.status}`;
      } catch {
        error = `HTTP ${res.status}`;
      }
    }
  }

  return {
    target,
    endpoint,
    status: res.status,
    ms,
    ok: res.ok,
    owner,
    error,
  };
}

function toCsv(rows) {
  const headers = ["target", "endpoint", "status", "ms", "ok", "owner", "error"];
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

async function main() {
  const env = loadEnv();
  const appUrl = must(env, "VITE_SUPABASE_URL");
  const appRef = projectRefFromUrl(appUrl);
  const dataRef = must(env, "DATA_PROJECT_REF");
  const accessToken = must(env, "SUPABASE_ACCESS_TOKEN");
  const appPublishable = must(env, "VITE_SUPABASE_PUBLISHABLE_KEY");
  const dataServiceRole = must(env, "DATA_SUPABASE_SERVICE_ROLE_KEY");
  const bridgeSecret = String(env.INTERNAL_BRIDGE_SECRET || "").trim();

  const admin = await ensureAdminSession(env);
  const appFunctions = await listFunctions(appRef, accessToken);
  const dataFunctions = await listFunctions(dataRef, accessToken);

  const rows = [];
  for (const fn of appFunctions) {
    rows.push(await probeOne({
      target: "APP",
      ref: appRef,
      endpoint: fn.name,
      timeoutMs: 30000,
      headersBase: {
        apikey: appPublishable,
        Authorization: `Bearer ${admin.accessToken}`,
      },
    }));
  }
  for (const fn of dataFunctions) {
    const base = {
      apikey: dataServiceRole,
      Authorization: `Bearer ${dataServiceRole}`,
    };
    if (bridgeSecret) base["x-internal-bridge-secret"] = bridgeSecret;
    rows.push(await probeOne({
      target: "DATA",
      ref: dataRef,
      endpoint: fn.name,
      timeoutMs: 30000,
      headersBase: base,
    }));
  }

  fs.mkdirSync(".tmp/perf", { recursive: true });
  fs.writeFileSync(".tmp/perf/edge_full_inventory_latency_auth.json", JSON.stringify(rows, null, 2), "utf8");
  fs.writeFileSync(".tmp/perf/edge_full_inventory_latency_auth.csv", toCsv(rows), "utf8");

  const byTarget = rows.reduce((acc, r) => {
    acc[r.target] = acc[r.target] || { total: 0, ok: 0 };
    acc[r.target].total += 1;
    if (r.ok) acc[r.target].ok += 1;
    return acc;
  }, {});

  const summary = {
    generated_at: new Date().toISOString(),
    admin_email: admin.email,
    app_ref: appRef,
    data_ref: dataRef,
    totals: {
      all: rows.length,
      ok: rows.filter((r) => r.ok).length,
      non_ok: rows.filter((r) => !r.ok).length,
    },
    by_target: byTarget,
  };
  fs.writeFileSync(".tmp/perf/edge_full_inventory_latency_auth_summary.json", JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

