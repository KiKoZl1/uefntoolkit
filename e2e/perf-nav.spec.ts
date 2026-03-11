import { test } from "@playwright/test";
import fs from "node:fs";

function percentile(vals: number[], p: number): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const idx = Math.floor(p * (s.length - 1));
  return Math.round(s[idx] * 10) / 10;
}

test("route navigation latency probe", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const routes = [
    "/",
    "/discover",
    "/reports",
    "/island?code=1653-3577-0370",
  ];
  const iterations = 5;
  const out: Array<Record<string, unknown>> = [];

  for (const route of routes) {
    const rows: Array<{ status: number | null; wallMs: number; dclMs: number | null; apiMaxMs: number; apiCount: number }> = [];

    for (let i = 0; i < iterations; i++) {
      const t0 = Date.now();
      const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForSelector("#root", { timeout: 30_000 });
      // Some routes keep polling/revalidating; use a fixed settle window instead of networkidle.
      await page.waitForTimeout(1200);
      const wallMs = Date.now() - t0;

      const nav = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (!n) return null;
        return {
          dcl: n.domContentLoadedEventEnd,
        };
      });

      const api = await page.evaluate(() => {
        const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const calls = entries.filter((e) => e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest");
        const durs = calls.map((e) => e.duration || 0).filter((v) => Number.isFinite(v));
        return {
          count: calls.length,
          max: durs.length ? Math.max(...durs) : 0,
        };
      });

      rows.push({
        status: response?.status() ?? null,
        wallMs,
        dclMs: nav?.dcl ?? null,
        apiMaxMs: api.max,
        apiCount: api.count,
      });
    }

    const wall = rows.map((r) => r.wallMs);
    const dcl = rows.map((r) => r.dclMs).filter((v): v is number => typeof v === "number");
    const apiMax = rows.map((r) => r.apiMaxMs);

    out.push({
      route,
      status_last: rows[rows.length - 1]?.status ?? null,
      wall_p50_ms: percentile(wall, 0.5),
      wall_p95_ms: percentile(wall, 0.95),
      dcl_p50_ms: percentile(dcl, 0.5),
      dcl_p95_ms: percentile(dcl, 0.95),
      api_calls_avg: Math.round((rows.reduce((a, r) => a + r.apiCount, 0) / rows.length) * 10) / 10,
      api_max_p95_ms: percentile(apiMax, 0.95),
    });
  }

  fs.mkdirSync('.tmp/perf', { recursive: true });
  fs.writeFileSync('.tmp/perf/route_nav_probe.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('ROUTE_NAV_PROBE=' + JSON.stringify(out));
});
