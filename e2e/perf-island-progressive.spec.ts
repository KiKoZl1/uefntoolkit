import { expect, test } from "@playwright/test";

test("island progressive fetch profile", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const root = String(baseURL || "http://127.0.0.1:4173");

  const percentile = (values: number[], p: number) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.floor((sorted.length - 1) * p);
    return sorted[idx];
  };

  const runs: Array<{ run: number; summaryMs: number | null; fullMs: number | null }> = [];

  for (let run = 1; run <= 5; run += 1) {
    const calls: Array<{ status: number; ms: number; mode: string; bytes: number }> = [];
    const starts = new WeakMap<object, number>();

    const onRequest = (req: any) => {
      const url = String(req.url() || "");
      if (!url.includes("/functions/v1/discover-island-page")) return;
      starts.set(req as unknown as object, Date.now());
    };

    const onResponse = async (resp: any) => {
      const url = String(resp.url() || "");
      if (!url.includes("/functions/v1/discover-island-page")) return;
      const reqObj = resp.request();
      const t0 = starts.get(reqObj as unknown as object) ?? Date.now();
      const ms = Math.max(0, Date.now() - t0);

      let mode = "full";
      let bytes = 0;
      try {
        const text = await resp.text();
        bytes = text.length;
        const parsed = text ? JSON.parse(text) : null;
        if (parsed && parsed.panelTimeline24h == null && parsed.series == null) mode = "summary";
      } catch {
        // ignore parse failures
      }

      calls.push({ status: resp.status(), ms, mode, bytes });
    };

    page.on("request", onRequest);
    page.on("response", onResponse);

    await page.goto(`${root}/island?code=1653-3577-0370`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("#root", { timeout: 30_000 });
    await page.waitForTimeout(9000);

    page.off("request", onRequest);
    page.off("response", onResponse);

    const summaryMs = calls.find((c) => c.mode === "summary")?.ms ?? null;
    const fullMs = calls.find((c) => c.mode === "full")?.ms ?? null;
    runs.push({ run, summaryMs, fullMs });
  }

  const summaryVals = runs.map((r) => r.summaryMs).filter((v): v is number => typeof v === "number");
  const fullVals = runs.map((r) => r.fullMs).filter((v): v is number => typeof v === "number");

  const result = {
    runs,
    summary: {
      p50_ms: percentile(summaryVals, 0.5),
      p95_ms: percentile(summaryVals, 0.95),
      max_ms: summaryVals.length ? Math.max(...summaryVals) : null,
    },
    full: {
      p50_ms: percentile(fullVals, 0.5),
      p95_ms: percentile(fullVals, 0.95),
      max_ms: fullVals.length ? Math.max(...fullVals) : null,
    },
  };

  console.log("ISLAND_PROGRESSIVE_PROFILE=" + JSON.stringify(result));
  const summaryP95Max = Number(process.env.PERF_ISLAND_SUMMARY_P95_MAX_MS || 3000);
  const fullP95Max = Number(process.env.PERF_ISLAND_FULL_P95_MAX_MS || 2000);
  const summaryMaxOutlier = Number(process.env.PERF_ISLAND_SUMMARY_MAX_OUTLIER_MS || 9000);
  const fullMaxOutlier = Number(process.env.PERF_ISLAND_FULL_MAX_OUTLIER_MS || 9000);

  expect(summaryVals.length).toBeGreaterThanOrEqual(4);
  expect(fullVals.length).toBeGreaterThanOrEqual(4);
  expect(result.summary.p95_ms ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(summaryP95Max);
  expect(result.full.p95_ms ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(fullP95Max);
  expect(result.summary.max_ms ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(summaryMaxOutlier);
  expect(result.full.max_ms ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(fullMaxOutlier);
});

