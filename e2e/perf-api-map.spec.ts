import { test } from "@playwright/test";
import fs from "node:fs";

function percentile(vals: number[], p: number): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const idx = Math.floor(p * (s.length - 1));
  return Math.round(s[idx] * 10) / 10;
}

test("route api call map", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const routes = ["/", "/discover", "/reports", "/island?code=1653-3577-0370"];
  const out: Record<string, unknown>[] = [];

  for (const route of routes) {
    const calls: Array<{ endpoint: string; status: number; ms: number | null }> = [];

    const onResponse = async (resp: any) => {
      const url = String(resp.url() || "");
      const isSupabaseFn = url.includes("/functions/v1/");
      const isSupabaseRest = url.includes("/rest/v1/");
      if (!isSupabaseFn && !isSupabaseRest) return;

      const endpoint = isSupabaseFn
        ? url.split("/functions/v1/")[1]?.split("?")[0] || "functions/unknown"
        : url.split("/rest/v1/")[1]?.split("?")[0] || "rest/unknown";

      const timing = resp.request().timing();
      let ms: number | null = null;
      if (typeof timing.responseEnd === "number" && typeof timing.startTime === "number" && timing.responseEnd >= 0) {
        ms = Math.max(0, timing.responseEnd - timing.startTime);
      }

      calls.push({ endpoint, status: resp.status(), ms });
    };

    page.on("response", onResponse);
    await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("#root", { timeout: 30_000 });
    await page.waitForTimeout(3000);
    page.off("response", onResponse);

    const perfDurations = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      return entries
        .filter((e) => e.name.includes("/functions/v1/") || e.name.includes("/rest/v1/"))
        .map((e) => ({ name: e.name, duration: e.duration || 0 }));
    });

    const perfMap = new Map<string, number[]>();
    for (const p of perfDurations) {
      const name = String(p.name || "");
      const endpoint = name.includes("/functions/v1/")
        ? name.split("/functions/v1/")[1]?.split("?")[0] || "functions/unknown"
        : name.split("/rest/v1/")[1]?.split("?")[0] || "rest/unknown";
      const arr = perfMap.get(endpoint) || [];
      arr.push(Number(p.duration || 0));
      perfMap.set(endpoint, arr);
    }

    const grouped = new Map<string, { endpoint: string; count: number; errors: number; msVals: number[]; statuses: number[] }>();
    for (const c of calls) {
      const key = c.endpoint;
      const row = grouped.get(key) || { endpoint: key, count: 0, errors: 0, msVals: [], statuses: [] };
      row.count += 1;
      if (c.status >= 400) row.errors += 1;
      row.statuses.push(c.status);
      if (typeof c.ms === "number") row.msVals.push(c.ms);
      grouped.set(key, row);
    }

    const endpointStats = Array.from(grouped.values())
      .map((g) => ({
        endpoint: g.endpoint,
        calls: g.count,
        error_calls: g.errors,
        statuses: Array.from(new Set(g.statuses)).sort((a, b) => a - b),
        p50_ms: percentile((g.msVals.length ? g.msVals : perfMap.get(g.endpoint) || []), 0.5),
        p95_ms: percentile((g.msVals.length ? g.msVals : perfMap.get(g.endpoint) || []), 0.95),
      }))
      .sort((a, b) => (b.p95_ms || 0) - (a.p95_ms || 0));

    out.push({
      route,
      total_api_calls: calls.length,
      endpoints: endpointStats,
    });
  }

  fs.mkdirSync('.tmp/perf', { recursive: true });
  fs.writeFileSync('.tmp/perf/route_api_map.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('ROUTE_API_MAP=' + JSON.stringify(out));
});
