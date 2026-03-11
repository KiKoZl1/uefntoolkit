import { test } from "@playwright/test";
import fs from "node:fs";

test("all declared routes latency map", async ({ page, baseURL }) => {
  test.setTimeout(300_000);

  const routes = [
    "/",
    "/discover",
    "/island?code=1653-3577-0370",
    "/reports",
    "/reports/sample-slug",
    "/auth",
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
    "/this-route-should-404",
  ];

  const out: Array<Record<string, unknown>> = [];

  for (const route of routes) {
    const t0 = Date.now();
    const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("#root", { timeout: 30_000 });
    await page.waitForTimeout(1200);
    const wallMs = Date.now() - t0;

    const finalPath = await page.evaluate(() => new URL(window.location.href).pathname + window.location.search);

    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!n) return null;
      return {
        dcl: n.domContentLoadedEventEnd,
        load: n.loadEventEnd,
      };
    });

    const api = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const calls = entries.filter((e) => e.name.includes("/functions/v1/") || e.name.includes("/rest/v1/"));
      const durations = calls.map((c) => c.duration || 0).filter((d) => Number.isFinite(d));
      return {
        totalCalls: calls.length,
        maxDuration: durations.length ? Math.max(...durations) : 0,
      };
    });

    out.push({
      route,
      http_status: response?.status() ?? null,
      final_path: finalPath,
      wall_ms: wallMs,
      dcl_ms: nav?.dcl ?? null,
      load_ms: nav?.load ?? null,
      api_calls: api.totalCalls,
      api_max_ms: api.maxDuration,
    });
  }

  fs.mkdirSync('.tmp/perf', { recursive: true });
  fs.writeFileSync('.tmp/perf/routes_all_latency.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('ROUTES_ALL_LATENCY=' + JSON.stringify(out));
});
