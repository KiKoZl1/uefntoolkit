import { test } from "@playwright/test";
import fs from "node:fs";
import { ensurePerfAdminAndLogin } from "./helpers/adminAuth";

type CallRow = {
  route: string;
  url: string;
  kind: "function" | "rest";
  endpoint: string;
  status: number;
  ms: number | null;
};

function percentile(vals: number[], p: number): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const idx = Math.floor(p * (s.length - 1));
  return Math.round(s[idx] * 10) / 10;
}

test("real frontend traffic latency map (admin auth)", async ({ page, baseURL }) => {
  test.setTimeout(480_000);
  const root = String(baseURL || "http://127.0.0.1:4173");

  await ensurePerfAdminAndLogin(page, root);

  const routes = [
    "/",
    "/discover",
    "/island?code=1653-3577-0370",
    "/reports",
    "/reports/sample-slug",
    "/app",
    "/app/projects/00000000-0000-0000-0000-000000000000",
    "/app/projects/00000000-0000-0000-0000-000000000000/reports/00000000-0000-0000-0000-000000000000",
    "/app/island-lookup",
    "/app/thumb-generator",
    "/app/widgetkit",
    "/app/widgetkit/psd-umg",
    "/app/widgetkit/umg-verse",
    "/app/thumb-tools",
    "/app/thumb-tools/generate",
    "/app/thumb-tools/edit-studio",
    "/app/thumb-tools/camera-control",
    "/app/thumb-tools/layer-decomposition",
    "/admin",
    "/admin/reports",
    "/admin/reports/00000000-0000-0000-0000-000000000000/edit",
    "/admin/exposure",
    "/admin/intel",
    "/admin/panels",
    "/admin/dppi",
    "/admin/dppi/models",
    "/admin/dppi/training",
    "/admin/dppi/inference",
    "/admin/dppi/drift",
    "/admin/dppi/calibration",
    "/admin/dppi/releases",
    "/admin/dppi/feedback",
    "/admin/tgis",
    "/admin/tgis/clusters",
    "/admin/tgis/dataset",
    "/admin/tgis/training",
    "/admin/tgis/models",
    "/admin/tgis/inference",
    "/admin/tgis/thumb-tools",
    "/admin/tgis/costs",
    "/admin/tgis/safety",
  ];

  const calls: CallRow[] = [];
  let currentRoute = "";
  const starts = new WeakMap<object, number>();

  const onRequest = (req: any) => {
    const url = String(req.url() || "");
    if (url.includes("/functions/v1/") || url.includes("/rest/v1/")) {
      starts.set(req, Date.now());
    }
  };

  const onResponse = (resp: any) => {
    const url = String(resp.url() || "");
    const isFn = url.includes("/functions/v1/");
    const isRest = url.includes("/rest/v1/");
    if (!isFn && !isRest) return;

    const endpoint = isFn
      ? (url.split("/functions/v1/")[1]?.split("?")[0] || "functions/unknown")
      : (url.split("/rest/v1/")[1]?.split("?")[0] || "rest/unknown");

    const reqObj = resp.request();
    const startMs = starts.get(reqObj as object);
    const ms = typeof startMs === "number" ? Math.max(0, Date.now() - startMs) : null;

    calls.push({
      route: currentRoute,
      url,
      kind: isFn ? "function" : "rest",
      endpoint,
      status: resp.status(),
      ms,
    });
  };

  page.on("request", onRequest);
  page.on("response", onResponse);

  for (const route of routes) {
    currentRoute = route;
    await page.goto(`${root}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("#root", { timeout: 30_000 });
    await page.waitForTimeout(1500);
  }

  page.off("request", onRequest);
  page.off("response", onResponse);

  const byEndpoint = new Map<string, { kind: string; endpoint: string; calls: number; errors: number; statuses: number[]; msVals: number[] }>();
  for (const c of calls) {
    const key = `${c.kind}:${c.endpoint}`;
    const row = byEndpoint.get(key) || { kind: c.kind, endpoint: c.endpoint, calls: 0, errors: 0, statuses: [], msVals: [] };
    row.calls += 1;
    if (c.status >= 400) row.errors += 1;
    row.statuses.push(c.status);
    if (typeof c.ms === "number") row.msVals.push(c.ms);
    byEndpoint.set(key, row);
  }

  const summary = Array.from(byEndpoint.values())
    .map((r) => ({
      kind: r.kind,
      endpoint: r.endpoint,
      calls: r.calls,
      error_calls: r.errors,
      statuses: Array.from(new Set(r.statuses)).sort((a, b) => a - b),
      p50_ms: percentile(r.msVals, 0.5),
      p95_ms: percentile(r.msVals, 0.95),
      max_ms: r.msVals.length ? Math.round(Math.max(...r.msVals) * 10) / 10 : null,
    }))
    .sort((a, b) => (b.p95_ms || 0) - (a.p95_ms || 0));

  fs.mkdirSync(".tmp/perf", { recursive: true });
  fs.writeFileSync(".tmp/perf/real_calls_admin_raw.json", JSON.stringify(calls, null, 2), "utf8");
  fs.writeFileSync(".tmp/perf/real_calls_admin_summary.json", JSON.stringify(summary, null, 2), "utf8");
  console.log("REAL_CALLS_ADMIN_SUMMARY=" + JSON.stringify(summary));
});
