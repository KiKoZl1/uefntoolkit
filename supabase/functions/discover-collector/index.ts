import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EPIC_API = "https://api.fortnite.com/ecosystem/v1";
const PAGE_SIZE = 1000;

// ========== Helpers ==========

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, retries = 3): Promise<{ data: any; status: number }> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return { data: await res.json(), status: res.status };
      if (res.status === 429) return { data: null, status: 429 };
      if (res.status === 404) return { data: null, status: 404 };
      console.error(`Error ${res.status} for ${url}`);
      return { data: null, status: res.status };
    } catch (e) {
      console.error(`Fetch error attempt ${i + 1}:`, e);
      if (i < retries - 1) await delay(1000 * (i + 1));
    }
  }
  return { data: null, status: 0 };
}

async function fetchIslandPage(cursor: string | null): Promise<{ islands: any[]; nextCursor: string | null }> {
  let url = `${EPIC_API}/islands?size=${PAGE_SIZE}`;
  if (cursor) url += `&after=${encodeURIComponent(cursor)}`;

  const { data } = await fetchWithRetry(url);
  if (!data?.data?.length) return { islands: [], nextCursor: null };

  let nextCursor: string | null = null;
  const rawCursor = data.meta?.page?.nextCursor || data.links?.next;
  if (rawCursor) {
    if (typeof rawCursor === "string" && rawCursor.includes("after=")) {
      const match = rawCursor.match(/after=([^&]+)/);
      nextCursor = match ? decodeURIComponent(match[1]) : null;
    } else {
      nextCursor = rawCursor;
    }
  }

  return { islands: data.data, nextCursor };
}

function sumMetric(arr: any[] | undefined): number {
  if (!arr || !Array.isArray(arr)) return 0;
  return arr.reduce((s: number, v: any) => s + (v?.value ?? 0), 0);
}

function avgMetric(arr: any[] | undefined): number {
  if (!arr?.length) return 0;
  const valid = arr.filter((v: any) => v?.value != null);
  if (!valid.length) return 0;
  return valid.reduce((s: number, v: any) => s + v.value, 0) / valid.length;
}

function maxMetric(arr: any[] | undefined): number {
  if (!arr?.length) return 0;
  const vals = arr.filter((v: any) => v?.value != null).map((v: any) => v.value);
  return vals.length ? Math.max(0, ...vals) : 0;
}

function avgRetentionCalc(retArr: any[] | undefined, key: string): number {
  if (!retArr?.length) return 0;
  const valid = retArr.filter((r: any) => r?.[key] != null);
  if (!valid.length) return 0;
  return valid.reduce((s: number, r: any) => s + r[key], 0) / valid.length;
}

const TREND_KEYWORDS = [
  "squid game", "zombie", "1v1", "tycoon", "survival", "horror", "deathrun",
  "box fight", "zone wars", "gun game", "hide and seek", "prop hunt",
  "roleplay", "rp", "parkour", "obby", "simulator", "battle royale",
  "build fight", "free build", "ffa", "pvp", "pve", "escape room",
  "murder mystery", "race", "dropper", "red vs blue", "capture the flag",
  "bed wars", "sky wars", "prison", "cops", "heist", "fashion show",
  "quiz", "trivia", "music", "concert", "dance", "among us",
  "sniper", "aim trainer", "warmup", "practice", "edit course",
  "lego", "rocket racing", "fall guys", "tmnt", "walking dead",
];

// ========== Main Handler ==========

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }

    const mode = body.mode || "start";
    const reportId = body.reportId || null;

    // ======================== MODE: START ========================
    if (mode === "start") {
      const now = new Date();
      const to = new Date(now);
      to.setUTCHours(0, 0, 0, 0);
      const from = new Date(to);
      from.setUTCDate(from.getUTCDate() - 7);

      const weekEnd = to.toISOString().split("T")[0];
      const weekStart = from.toISOString().split("T")[0];
      const d = new Date(from);
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNumber = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      const year = d.getUTCFullYear();

      // Get estimated_total from last completed report
      const { data: lastReport } = await supabase
        .from("discover_reports")
        .select("queue_total")
        .eq("phase", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      const estimatedTotal = lastReport?.queue_total || null;

      const { data: report, error: reportErr } = await supabase
        .from("discover_reports")
        .insert({
          week_start: weekStart,
          week_end: weekEnd,
          week_number: weekNumber,
          year,
          status: "collecting",
          phase: "catalog",
          estimated_total: estimatedTotal,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (reportErr) throw new Error(`Failed to create report: ${reportErr.message}`);

      console.log(`[start] Created report ${report.id}, estimated_total=${estimatedTotal}`);

      return new Response(JSON.stringify({
        success: true, reportId: report.id, estimated_total: estimatedTotal, phase: "catalog",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // All subsequent modes need reportId
    if (!reportId) throw new Error("reportId is required");

    // ======================== MODE: CATALOG ========================
    if (mode === "catalog") {
      const { data: report } = await supabase
        .from("discover_reports")
        .select("catalog_cursor, catalog_discovered_count, estimated_total")
        .eq("id", reportId)
        .single();

      if (!report) throw new Error("Report not found");

      const startTime = Date.now();
      let cursor = report.catalog_cursor;
      let discovered = report.catalog_discovered_count || 0;
      let exhausted = false;
      let pagesThisRun = 0;

      // Preload cache for priority assignment
      const { data: cacheRows } = await supabase
        .from("discover_islands_cache")
        .select("island_code, last_status, suppressed_streak");
      const cacheMap = new Map<string, { last_status: string | null; suppressed_streak: number }>();
      for (const c of (cacheRows || [])) {
        cacheMap.set(c.island_code, { last_status: c.last_status, suppressed_streak: c.suppressed_streak || 0 });
      }

      // Paginate as much as possible within 40s budget
      while (Date.now() - startTime < 40000) {
        const { islands, nextCursor } = await fetchIslandPage(cursor);
        if (!islands.length) { exhausted = true; break; }

        pagesThisRun++;
        
        // Bulk insert into queue with priority from cache
        const queueRows = islands.map((isl: any) => {
          const cached = cacheMap.get(isl.code);
          let priority = 20; // default: new island
          if (cached) {
            if (cached.last_status === "reported") priority = 10;
            else if (cached.suppressed_streak <= 2) priority = 30;
            else priority = 50;
          }
          return {
            report_id: reportId,
            island_code: isl.code,
            priority,
          };
        });

        // Pre-populate island metadata from catalog listing
        const metaRows = islands.map((isl: any) => ({
          report_id: reportId,
          island_code: isl.code,
          title: isl.title || null,
          creator_code: isl.creatorCode || null,
          category: isl.category || null,
          created_in: isl.createdIn || null,
          tags: isl.tags || [],
          status: "pending",
        }));

        // Insert metadata in chunks of 500
        for (let i = 0; i < metaRows.length; i += 500) {
          const chunk = metaRows.slice(i, i + 500);
          await supabase.from("discover_report_islands").upsert(chunk, {
            onConflict: "report_id,island_code",
            ignoreDuplicates: true,
          });
        }

        // Insert in chunks of 500
        for (let i = 0; i < queueRows.length; i += 500) {
          const chunk = queueRows.slice(i, i + 500);
          await supabase.from("discover_report_queue").upsert(chunk, {
            onConflict: "report_id,island_code",
            ignoreDuplicates: true,
          });
        }

        discovered += islands.length;
        cursor = nextCursor;
        if (!cursor) { exhausted = true; break; }
      }

      // Update report state
      const progressPct = report.estimated_total
        ? Math.min(10, Math.floor((discovered / report.estimated_total) * 10))
        : 0;

      const updateFields: any = {
        catalog_discovered_count: discovered,
        catalog_cursor: cursor,
        progress_pct: progressPct,
      };

      if (exhausted) {
        // Count total queue items
        const { count } = await supabase
          .from("discover_report_queue")
          .select("*", { count: "exact", head: true })
          .eq("report_id", reportId);

        updateFields.catalog_done = true;
        updateFields.queue_total = count || discovered;
        updateFields.phase = "metrics";
        updateFields.progress_pct = 10;
      }

      await supabase.from("discover_reports").update(updateFields).eq("id", reportId);

      console.log(`[catalog] pages=${pagesThisRun}, discovered=${discovered}, exhausted=${exhausted}`);

      return new Response(JSON.stringify({
        success: true,
        phase: exhausted ? "metrics" : "catalog",
        catalog_discovered_count: discovered,
        catalog_done: exhausted,
        queue_total: updateFields.queue_total || null,
        progress_pct: updateFields.progress_pct,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ======================== MODE: METRICS ========================
    if (mode === "metrics") {
      const { data: report } = await supabase
        .from("discover_reports")
        .select("queue_total, metrics_done_count, reported_count, suppressed_count, error_count")
        .eq("id", reportId)
        .single();

      if (!report) throw new Error("Report not found");

      const BATCH_SIZE = 500;
      const startTime = Date.now();

      // Fetch pending items from queue ordered by priority (lower = higher priority)
      const { data: pendingItems, error: fetchErr } = await supabase
        .from("discover_report_queue")
        .select("id, island_code, priority")
        .eq("report_id", reportId)
        .eq("status", "pending")
        .order("priority", { ascending: true })
        .limit(BATCH_SIZE);

      if (fetchErr) throw new Error(`Queue fetch error: ${fetchErr.message}`);
      if (!pendingItems?.length) {
        // All done
        await supabase.from("discover_reports").update({
          phase: "finalize",
          progress_pct: 95,
        }).eq("id", reportId);

        return new Response(JSON.stringify({
          success: true, phase: "finalize",
          metrics_done_count: report.metrics_done_count,
          queue_total: report.queue_total,
          reported_count: report.reported_count,
          suppressed_count: report.suppressed_count,
          error_count: report.error_count,
          progress_pct: 95,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Lock items: set status to processing
      const itemIds = pendingItems.map((i: any) => i.id);
      await supabase.from("discover_report_queue")
        .update({ status: "processing", locked_at: new Date().toISOString() })
        .in("id", itemIds);

      // Load cache for suppressed_streak skip logic
      const islandCodes = pendingItems.map((i: any) => i.island_code);
      const { data: cacheRows } = await supabase
        .from("discover_islands_cache")
        .select("island_code, last_status, suppressed_streak, last_reported_at, last_week_unique, last_week_plays, last_week_minutes, last_week_peak_ccu, last_week_favorites, last_week_recommends")
        .in("island_code", islandCodes);
      const cacheMap = new Map<string, any>();
      for (const c of (cacheRows || [])) cacheMap.set(c.island_code, c);

      // Date calculations
      const now = new Date();
      const todayMidnight = new Date(now);
      todayMidnight.setUTCHours(0, 0, 0, 0);
      const yesterday = new Date(todayMidnight);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const sevenDaysAgo = new Date(todayMidnight);
      sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

      const weekFrom = sevenDaysAgo.toISOString();
      const weekTo = todayMidnight.toISOString();
      const sixtyDaysAgo = new Date(todayMidnight);
      sixtyDaysAgo.setUTCDate(sixtyDaysAgo.getUTCDate() - 60);

      // Adaptive concurrency
      let concurrency = 15;
      let consecutiveOk = 0;
      let reported = 0;
      let suppressed = 0;
      let errors = 0;
      let processed = 0;
      let skipped = 0;

      const islandQueue: any[] = [];
      const skipQueue: any[] = [];

      // Separate items: skip chronic suppressed vs normal processing
      for (const item of pendingItems) {
        const cached = cacheMap.get(item.island_code);
        if (cached && cached.suppressed_streak >= 6) {
          const lastReported = cached.last_reported_at ? new Date(cached.last_reported_at) : null;
          const isOld = !lastReported || lastReported < sixtyDaysAgo;
          // Revalidate 10% randomly
          const shouldRevalidate = Math.random() < 0.1;
          if (isOld && !shouldRevalidate) {
            skipQueue.push(item);
            continue;
          }
        }
        islandQueue.push(item);
      }

      // Process skipped items (assumed suppressed, no API call)
      const skipUpserts: any[] = [];
      const skipCacheUpserts: any[] = [];
      const skipQueueUpdates: any[] = [];
      for (const item of skipQueue) {
        skipped++;
        suppressed++;
        processed++;
        skipUpserts.push({
          report_id: reportId,
          island_code: item.island_code,
          status: "suppressed",
        });
        const cached = cacheMap.get(item.island_code);
        skipCacheUpserts.push({
          island_code: item.island_code,
          last_seen_at: new Date().toISOString(),
          last_status: "suppressed",
          last_report_id: reportId,
          last_suppressed_at: new Date().toISOString(),
          suppressed_streak: (cached?.suppressed_streak || 0) + 1,
          reported_streak: 0,
          updated_at: new Date().toISOString(),
        });
        skipQueueUpdates.push(item.id);
      }

      // Batch upsert skip results
      for (let i = 0; i < skipUpserts.length; i += 100) {
        await supabase.from("discover_report_islands").upsert(skipUpserts.slice(i, i + 100), { onConflict: "report_id,island_code" });
      }
      for (let i = 0; i < skipCacheUpserts.length; i += 100) {
        await supabase.from("discover_islands_cache").upsert(skipCacheUpserts.slice(i, i + 100), { onConflict: "island_code" });
      }
      if (skipQueueUpdates.length > 0) {
        await supabase.from("discover_report_queue").update({ status: "done" }).in("id", skipQueueUpdates);
      }

      const islandUpserts: any[] = [];
      const cacheUpserts: any[] = [];
      const queueUpdates: { id: string; status: string; last_error?: string }[] = [];

      while (islandQueue.length > 0 && Date.now() - startTime < 45000) {
        const batch = islandQueue.splice(0, concurrency);

        const results = await Promise.all(batch.map(async (item: any) => {
          try {
            // SINGLE 7-day fetch
            const weekUrl = `${EPIC_API}/islands/${item.island_code}/metrics/day?from=${weekFrom}&to=${weekTo}`;
            const weekRes = await fetchWithRetry(weekUrl);

            if (weekRes.status === 429) return { item, rateLimited: true };
            if (!weekRes.data) {
              return { item, error: true, errorMsg: `Metrics failed: status ${weekRes.status}` };
            }

            const m = weekRes.data;
            const weekUnique = sumMetric(m.uniquePlayers);
            const weekPlays = sumMetric(m.plays);
            const weekMinutes = sumMetric(m.minutesPlayed);
            const weekPeakCcu = maxMetric(m.peakCCU);

            const hasData = weekUnique > 0 || weekPlays > 0;

            if (!hasData) {
              return {
                item,
                suppressed: true,
                islandData: {
                  report_id: reportId,
                  island_code: item.island_code,
                  status: "suppressed",
                },
              };
            }

            // Has data — compute all aggregates
            const weekMpp = avgMetric(m.averageMinutesPerPlayer);
            const weekFavorites = sumMetric(m.favorites);
            const weekRecommends = sumMetric(m.recommendations);
            const weekD1 = avgRetentionCalc(m.retention, "d1");
            const weekD7 = avgRetentionCalc(m.retention, "d7");

            // Extract yesterday's probe values
            const yesterdayStr = yesterday.toISOString().split("T")[0];
            const probeUnique = m.uniquePlayers?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;
            const probePlays = m.plays?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;
            const probeMinutes = m.minutesPlayed?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;
            const probePeakCcu = m.peakCCU?.find((v: any) => v.timestamp?.startsWith(yesterdayStr))?.value ?? 0;

            return {
              item,
              reported: true,
              islandData: {
                report_id: reportId,
                island_code: item.island_code,
                status: "reported",
                probe_unique: probeUnique,
                probe_plays: probePlays,
                probe_minutes: probeMinutes,
                probe_peak_ccu: probePeakCcu,
                probe_date: yesterdayStr,
                week_unique: weekUnique,
                week_plays: weekPlays,
                week_minutes: weekMinutes,
                week_minutes_per_player_avg: weekMpp,
                week_peak_ccu_max: weekPeakCcu,
                week_favorites: weekFavorites,
                week_recommends: weekRecommends,
                week_d1_avg: weekD1,
                week_d7_avg: weekD7,
              },
              weekData: { weekUnique, weekPlays, weekMinutes, weekPeakCcu, weekFavorites, weekRecommends, weekMpp, weekD1, weekD7, probeUnique, probePlays },
            };
          } catch (e) {
            return { item, error: true, errorMsg: e instanceof Error ? e.message : "Unknown" };
          }
        }));

        // Check for rate limits
        const hasRateLimit = results.some((r: any) => r.rateLimited);
        if (hasRateLimit) {
          for (const r of results) {
            if (r.rateLimited) islandQueue.unshift(r.item);
          }
          concurrency = Math.max(3, Math.floor(concurrency / 2));
          consecutiveOk = 0;
          const backoffMs = 3000 * (1 + Math.random());
          console.log(`[metrics] 429 hit, concurrency -> ${concurrency}, backoff ${Math.round(backoffMs)}ms`);
          await delay(backoffMs);
        } else {
          consecutiveOk++;
          if (consecutiveOk >= 5 && concurrency < 30) {
            concurrency += 2;
            consecutiveOk = 0;
          }
        }

        // Process results — write-through to cache
        for (const r of results) {
          if (r.rateLimited) continue;
          processed++;

          if (r.error) {
            errors++;
            queueUpdates.push({ id: r.item.id, status: "error", last_error: r.errorMsg });
          } else if (r.suppressed) {
            suppressed++;
            islandUpserts.push(r.islandData);
            queueUpdates.push({ id: r.item.id, status: "done" });
            // Write-through cache: suppressed
            const cached = cacheMap.get(r.item.island_code);
            cacheUpserts.push({
              island_code: r.item.island_code,
              last_seen_at: new Date().toISOString(),
              last_status: "suppressed",
              last_report_id: reportId,
              last_suppressed_at: new Date().toISOString(),
              suppressed_streak: (cached?.suppressed_streak || 0) + 1,
              reported_streak: 0,
              updated_at: new Date().toISOString(),
            });
          } else if (r.reported) {
            reported++;
            islandUpserts.push(r.islandData);
            queueUpdates.push({ id: r.item.id, status: "done" });
            // Write-through cache: reported
            const wd = r.weekData;
            cacheUpserts.push({
              island_code: r.item.island_code,
              last_seen_at: new Date().toISOString(),
              last_status: "reported",
              last_report_id: reportId,
              last_reported_at: new Date().toISOString(),
              suppressed_streak: 0,
              reported_streak: (cacheMap.get(r.item.island_code)?.reported_streak || 0) + 1,
              last_probe_unique: wd.probeUnique,
              last_probe_plays: wd.probePlays,
              last_week_unique: wd.weekUnique,
              last_week_plays: wd.weekPlays,
              last_week_minutes: wd.weekMinutes,
              last_week_peak_ccu: wd.weekPeakCcu,
              last_week_favorites: wd.weekFavorites,
              last_week_recommends: wd.weekRecommends,
              last_week_d1_avg: wd.weekD1,
              last_week_d7_avg: wd.weekD7,
              last_week_minutes_per_player_avg: wd.weekMpp,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      // Batch upsert island data
      for (let i = 0; i < islandUpserts.length; i += 100) {
        await supabase.from("discover_report_islands").upsert(islandUpserts.slice(i, i + 100), { onConflict: "report_id,island_code" });
      }

      // Batch upsert cache
      for (let i = 0; i < cacheUpserts.length; i += 100) {
        await supabase.from("discover_islands_cache").upsert(cacheUpserts.slice(i, i + 100), { onConflict: "island_code" });
      }

      // Batch update queue statuses
      for (const upd of queueUpdates) {
        await supabase.from("discover_report_queue")
          .update({ status: upd.status, last_error: upd.last_error || null })
          .eq("id", upd.id);
      }

      // Update report counters
      const newMetricsDone = (report.metrics_done_count || 0) + processed;
      const newReported = (report.reported_count || 0) + reported;
      const newSuppressed = (report.suppressed_count || 0) + suppressed;
      const newErrors = (report.error_count || 0) + errors;
      const queueTotal = report.queue_total || 1;
      const progressPct = Math.min(95, 10 + Math.floor((newMetricsDone / queueTotal) * 85));

      const isDone = newMetricsDone >= queueTotal;

      await supabase.from("discover_reports").update({
        metrics_done_count: newMetricsDone,
        reported_count: newReported,
        suppressed_count: newSuppressed,
        error_count: newErrors,
        progress_pct: isDone ? 95 : progressPct,
        phase: isDone ? "finalize" : "metrics",
      }).eq("id", reportId);

      console.log(`[metrics] processed=${processed}, reported=${reported}, suppressed=${suppressed}, skipped=${skipped}, errors=${errors}, total=${newMetricsDone}/${queueTotal}, concurrency=${concurrency}`);

      return new Response(JSON.stringify({
        success: true,
        phase: isDone ? "finalize" : "metrics",
        metrics_done_count: newMetricsDone,
        queue_total: queueTotal,
        reported_count: newReported,
        suppressed_count: newSuppressed,
        error_count: newErrors,
        progress_pct: isDone ? 95 : progressPct,
        batch_processed: processed,
        batch_skipped: skipped,
        concurrency,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ======================== MODE: FINALIZE ========================
    if (mode === "finalize") {
      console.log(`[finalize] Starting for report ${reportId}`);

      // Get report info for week_start
      const { data: reportInfo } = await supabase
        .from("discover_reports")
        .select("week_start")
        .eq("id", reportId)
        .single();

      const weekStart = reportInfo?.week_start;

      // Load cache for new/revived/dead detection
      const { data: allCache } = await supabase
        .from("discover_islands_cache")
        .select("island_code, first_seen_at, last_status, reported_streak, suppressed_streak, last_suppressed_at, last_reported_at, last_week_unique, last_week_plays, last_week_minutes, last_week_peak_ccu, last_week_favorites, last_week_recommends, title, creator_code, category")
        .limit(50000);
      
      const cacheMap = new Map<string, any>();
      for (const c of (allCache || [])) cacheMap.set(c.island_code, c);

      // Fetch all reported islands for this report
      const { data: reportedIslands, error: riError } = await supabase
        .from("discover_report_islands")
        .select("*")
        .eq("report_id", reportId)
        .eq("status", "reported");

      if (riError) throw new Error(`Failed to fetch report islands: ${riError.message}`);

      const islands = reportedIslands || [];
      console.log(`[finalize] ${islands.length} reported islands`);

      // Get counts
      const { count: totalQueued } = await supabase
        .from("discover_report_queue")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId);

      const { count: suppressedCount } = await supabase
        .from("discover_report_islands")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId)
        .eq("status", "suppressed");

      // ---- Detect new islands & creators from cache ----
      const newIslandsFromCache = (allCache || []).filter((c: any) => {
        if (!c.first_seen_at || !weekStart) return false;
        return c.first_seen_at >= weekStart;
      });
      const newIslandCodes = new Set(newIslandsFromCache.map((c: any) => c.island_code));

      // Detect new creators: creators whose first island appeared this week
      const creatorsFirstSeen: Record<string, string> = {};
      for (const c of (allCache || [])) {
        if (!c.creator_code || !c.first_seen_at) continue;
        if (!creatorsFirstSeen[c.creator_code] || c.first_seen_at < creatorsFirstSeen[c.creator_code]) {
          creatorsFirstSeen[c.creator_code] = c.first_seen_at;
        }
      }
      const newCreatorsList = weekStart
        ? Object.entries(creatorsFirstSeen).filter(([_, firstSeen]) => firstSeen >= weekStart).map(([code]) => code)
        : [];

      // ---- Detect revived islands (reported_streak=1 and had suppressed before) ----
      const revivedIslands: any[] = [];
      for (const isl of islands) {
        const cached = cacheMap.get(isl.island_code);
        if (cached && cached.reported_streak === 1 && cached.last_suppressed_at) {
          revivedIslands.push({
            code: isl.island_code,
            name: isl.title || isl.island_code,
            title: isl.title,
            creator: isl.creator_code,
            category: isl.category,
            value: isl.week_plays || 0,
          });
        }
      }

      // ---- Detect dead islands (were reported in previous cache, now suppressed this report) ----
      const { data: suppressedIslands } = await supabase
        .from("discover_report_islands")
        .select("island_code, title, creator_code, category")
        .eq("report_id", reportId)
        .eq("status", "suppressed")
        .limit(1000);

      const deadIslands: any[] = [];
      for (const si of (suppressedIslands || [])) {
        const cached = cacheMap.get(si.island_code);
        // Was reported before (had last_reported_at) and now suppressed with streak=1
        if (cached && cached.suppressed_streak === 1 && cached.last_reported_at) {
          deadIslands.push({
            code: si.island_code,
            name: si.title || si.island_code,
            title: si.title,
            creator: si.creator_code,
            category: si.category,
            value: cached.last_week_plays || 0,
          });
        }
      }

      // ---- WoW deltas per island ----
      const islandsWithDelta = islands.map((isl: any) => {
        const cached = cacheMap.get(isl.island_code);
        // Cache contains PREVIOUS week data (written before this report's write-through)
        // But since write-through already ran in metrics mode, cache has current data
        // We need to compare current report values vs cache's last_week_* (which are from previous report)
        // Note: at this point cache already has THIS week's data from write-through, so we can't compare directly
        // The write-through in metrics wrote the current week values, overwriting previous ones
        // So we need the previous report's data instead
        return {
          ...isl,
          delta_plays: null as number | null,
          delta_unique: null as number | null,
          delta_minutes: null as number | null,
          delta_peak_ccu: null as number | null,
          delta_favorites: null as number | null,
          delta_recommends: null as number | null,
        };
      });

      // Get previous report for WoW comparison
      const { data: prevReport } = await supabase
        .from("discover_reports")
        .select("id, platform_kpis")
        .eq("phase", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      // If we have a previous report, fetch its island data for WoW deltas
      if (prevReport?.id) {
        const { data: prevIslands } = await supabase
          .from("discover_report_islands")
          .select("island_code, week_plays, week_unique, week_minutes, week_peak_ccu_max, week_favorites, week_recommends")
          .eq("report_id", prevReport.id)
          .eq("status", "reported");

        const prevMap = new Map<string, any>();
        for (const pi of (prevIslands || [])) prevMap.set(pi.island_code, pi);

        for (const isl of islandsWithDelta) {
          const prev = prevMap.get(isl.island_code);
          if (prev) {
            isl.delta_plays = (isl.week_plays || 0) - (prev.week_plays || 0);
            isl.delta_unique = (isl.week_unique || 0) - (prev.week_unique || 0);
            isl.delta_minutes = (isl.week_minutes || 0) - (prev.week_minutes || 0);
            isl.delta_peak_ccu = (isl.week_peak_ccu_max || 0) - (prev.week_peak_ccu_max || 0);
            isl.delta_favorites = (isl.week_favorites || 0) - (prev.week_favorites || 0);
            isl.delta_recommends = (isl.week_recommends || 0) - (prev.week_recommends || 0);
          }
        }
      }

      // Compute KPIs
      const activeIslands = islands.filter((i: any) => (i.week_unique || 0) >= 5);
      const uniqueCreators = new Set(islands.map((i: any) => i.creator_code).filter(Boolean));
      const safeDiv = (n: number, d: number) => d > 0 ? n / d : 0;

      const totalPlays = islands.reduce((s: number, i: any) => s + (i.week_plays || 0), 0);
      const totalPlayers = islands.reduce((s: number, i: any) => s + (i.week_unique || 0), 0);
      const totalMinutes = islands.reduce((s: number, i: any) => s + (i.week_minutes || 0), 0);
      const totalFavorites = islands.reduce((s: number, i: any) => s + (i.week_favorites || 0), 0);
      const totalRecommends = islands.reduce((s: number, i: any) => s + (i.week_recommends || 0), 0);

      // New islands from report (reported + new to cache)
      const newIslandsReported = islands.filter((i: any) => newIslandCodes.has(i.island_code));
      const failedIslands = islands.filter((i: any) => (i.week_unique || 0) > 0 && (i.week_unique || 0) < 500);

      // WoW KPIs
      const prevKpis = prevReport?.platform_kpis || {};
      const wowDelta = (current: number, prev: number) => prev > 0 ? ((current - prev) / prev) * 100 : null;

      const platformKPIs: any = {
        totalIslands: totalQueued || islands.length,
        activeIslands: activeIslands.length,
        inactiveIslands: (totalQueued || 0) - activeIslands.length,
        suppressedIslands: suppressedCount || 0,
        totalCreators: uniqueCreators.size,
        avgMapsPerCreator: safeDiv(islands.length, uniqueCreators.size),
        totalPlays,
        totalUniquePlayers: totalPlayers,
        totalMinutesPlayed: totalMinutes,
        totalFavorites,
        totalRecommendations: totalRecommends,
        avgPlayDuration: safeDiv(
          activeIslands.reduce((s: number, i: any) => s + (i.week_minutes_per_player_avg || 0), 0),
          activeIslands.length
        ),
        avgCCUPerMap: safeDiv(
          activeIslands.reduce((s: number, i: any) => s + (i.week_peak_ccu_max || 0), 0),
          activeIslands.length
        ),
        avgPlayersPerDay: safeDiv(totalPlayers, 7),
        avgRetentionD1: safeDiv(
          activeIslands.reduce((s: number, i: any) => s + (i.week_d1_avg || 0), 0),
          activeIslands.length
        ),
        avgRetentionD7: safeDiv(
          activeIslands.reduce((s: number, i: any) => s + (i.week_d7_avg || 0), 0),
          activeIslands.length
        ),
        favToPlayRatio: safeDiv(totalFavorites, totalPlays),
        recToPlayRatio: safeDiv(totalRecommends, totalPlays),
        newMapsThisWeek: newIslandsReported.length,
        newCreatorsThisWeek: newCreatorsList.length,
        failedIslands: failedIslands.length,
        // WoW deltas (percentage change)
        wowTotalPlays: wowDelta(totalPlays, prevKpis.totalPlays || 0),
        wowTotalPlayers: wowDelta(totalPlayers, prevKpis.totalUniquePlayers || 0),
        wowTotalMinutes: wowDelta(totalMinutes, prevKpis.totalMinutesPlayed || 0),
        wowActiveIslands: wowDelta(activeIslands.length, prevKpis.activeIslands || 0),
        wowNewMaps: newIslandsReported.length - (prevKpis.newMapsThisWeek || 0),
        wowNewCreators: newCreatorsList.length - (prevKpis.newCreatorsThisWeek || 0),
        revivedCount: revivedIslands.length,
        deadCount: deadIslands.length,
      };

      // Rankings helper
      const topN = (arr: any[], key: string, n: number) =>
        [...arr]
          .filter((i) => i[key] != null && Number(i[key]) > 0)
          .sort((a, b) => Number(b[key]) - Number(a[key]))
          .slice(0, n)
          .map((i) => ({
            code: i.island_code || i.code,
            title: i.title || i.island_code || i.code,
            creator: i.creator_code || i.creator || "unknown",
            category: i.category || "Fortnite UGC",
            value: Number(i[key]),
            name: i.title || i.name || i.creator_code || i.island_code || i.code,
          }));

      // UGC filter
      const ugcIslands = islands.filter((i: any) => i.creator_code !== "fortnite" && i.creator_code !== "epic");

      // Creator aggregation
      const creatorsMap: Record<string, any> = {};
      for (const isl of islands) {
        const ck = isl.creator_code || "unknown";
        if (!creatorsMap[ck]) {
          creatorsMap[ck] = { name: ck, creator: ck, totalPlays: 0, uniquePlayers: 0, minutesPlayed: 0, peakCCU: 0, maps: 0, favorites: 0, recommendations: 0, sumD1: 0, sumD7: 0, countD1: 0, countD7: 0 };
        }
        const c = creatorsMap[ck];
        c.totalPlays += isl.week_plays || 0;
        c.uniquePlayers += isl.week_unique || 0;
        c.minutesPlayed += isl.week_minutes || 0;
        c.peakCCU = Math.max(c.peakCCU, isl.week_peak_ccu_max || 0);
        c.favorites += isl.week_favorites || 0;
        c.recommendations += isl.week_recommends || 0;
        c.maps++;
        if ((isl.week_d1_avg || 0) > 0) { c.sumD1 += isl.week_d1_avg; c.countD1++; }
        if ((isl.week_d7_avg || 0) > 0) { c.sumD7 += isl.week_d7_avg; c.countD7++; }
      }
      const creators = Object.values(creatorsMap).map((c: any) => ({
        ...c,
        avgD1: c.countD1 > 0 ? c.sumD1 / c.countD1 : 0,
        avgD7: c.countD7 > 0 ? c.sumD7 / c.countD7 : 0,
        value: c.totalPlays,
      }));

      // Category aggregation
      const categoriesMap: Record<string, any> = {};
      const tagsMap: Record<string, number> = {};
      for (const isl of islands) {
        const cat = isl.category || "Fortnite UGC";
        if (!categoriesMap[cat]) {
          categoriesMap[cat] = { name: cat, category: cat, totalPlays: 0, uniquePlayers: 0, minutesPlayed: 0, peakCCU: 0, maps: 0, favorites: 0, recommendations: 0 };
        }
        const cm = categoriesMap[cat];
        cm.totalPlays += isl.week_plays || 0;
        cm.uniquePlayers += isl.week_unique || 0;
        cm.minutesPlayed += isl.week_minutes || 0;
        cm.peakCCU = Math.max(cm.peakCCU, isl.week_peak_ccu_max || 0);
        cm.favorites += isl.week_favorites || 0;
        cm.recommendations += isl.week_recommends || 0;
        cm.maps++;

        if (Array.isArray(isl.tags)) {
          for (const tag of isl.tags) {
            if (typeof tag === "string") tagsMap[tag] = (tagsMap[tag] || 0) + 1;
          }
        }
      }
      const categories = Object.values(categoriesMap).map((c: any) => ({
        ...c,
        title: c.category === "None" ? "Fortnite UGC" : c.category,
        avgPlays: c.maps > 0 ? Math.round(c.totalPlays / c.maps) : 0,
        value: c.totalPlays,
      }));
      const topTags = Object.entries(tagsMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([tag, count]) => ({ name: tag, tag, value: count, count }));

      // Derived metrics
      const enriched = islands.map((i: any) => ({
        ...i,
        island_code: i.island_code,
        playsPerPlayer: (i.week_unique || 0) > 0 ? (i.week_plays || 0) / i.week_unique : 0,
        favPer100: (i.week_unique || 0) > 0 ? ((i.week_favorites || 0) / i.week_unique) * 100 : 0,
        recPer100: (i.week_unique || 0) > 0 ? ((i.week_recommends || 0) / i.week_unique) * 100 : 0,
        favToPlayRatio: (i.week_plays || 0) > 0 ? (i.week_favorites || 0) / i.week_plays : 0,
        recToPlayRatio: (i.week_plays || 0) > 0 ? (i.week_recommends || 0) / i.week_plays : 0,
        retentionAdjD1: (i.week_minutes_per_player_avg || 0) * (i.week_d1_avg || 0),
        retentionAdjD7: (i.week_minutes_per_player_avg || 0) * (i.week_d7_avg || 0),
      }));

      // Trend detection
      const trendMap: Record<string, any> = {};
      for (const isl of enriched) {
        const titleLower = (isl.title || "").toLowerCase();
        for (const kw of TREND_KEYWORDS) {
          if (titleLower.includes(kw)) {
            if (!trendMap[kw]) trendMap[kw] = { keyword: kw, islands: 0, totalPlays: 0, totalPlayers: 0, peakCCU: 0, avgD1: 0, d1Count: 0 };
            const t = trendMap[kw];
            t.islands++;
            t.totalPlays += isl.week_plays || 0;
            t.totalPlayers += isl.week_unique || 0;
            t.peakCCU = Math.max(t.peakCCU, isl.week_peak_ccu_max || 0);
            if ((isl.week_d1_avg || 0) > 0) { t.avgD1 += isl.week_d1_avg; t.d1Count++; }
          }
        }
      }
      const trendingTopics = Object.values(trendMap)
        .map((t: any) => ({
          name: t.keyword.charAt(0).toUpperCase() + t.keyword.slice(1),
          keyword: t.keyword,
          islands: t.islands,
          totalPlays: t.totalPlays,
          totalPlayers: t.totalPlayers,
          peakCCU: t.peakCCU,
          avgD1: t.d1Count > 0 ? t.avgD1 / t.d1Count : 0,
          value: t.totalPlays,
        }))
        .filter((t: any) => t.islands >= 3)
        .sort((a: any, b: any) => b.totalPlays - a.totalPlays)
        .slice(0, 20);

      // Top risers / decliners (by delta_plays)
      const withDeltas = islandsWithDelta.filter((i) => i.delta_plays != null);
      const topRisers = [...withDeltas]
        .sort((a, b) => (b.delta_plays || 0) - (a.delta_plays || 0))
        .slice(0, 10)
        .filter((i) => (i.delta_plays || 0) > 0)
        .map((i) => ({
          code: i.island_code,
          name: i.title || i.island_code,
          title: i.title,
          creator: i.creator_code,
          category: i.category,
          value: i.delta_plays || 0,
          label: `+${fmt(i.delta_plays || 0)} plays`,
        }));

      const topDecliners = [...withDeltas]
        .sort((a, b) => (a.delta_plays || 0) - (b.delta_plays || 0))
        .slice(0, 10)
        .filter((i) => (i.delta_plays || 0) < 0)
        .map((i) => ({
          code: i.island_code,
          name: i.title || i.island_code,
          title: i.title,
          creator: i.creator_code,
          category: i.category,
          value: Math.abs(i.delta_plays || 0),
          label: `${fmt(i.delta_plays || 0)} plays`,
        }));

      // Breakouts: were suppressed, now in top reported
      const breakouts = revivedIslands
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);

      const computedRankings = {
        topPeakCCU: topN(enriched, "week_peak_ccu_max", 10),
        topPeakCCU_UGC: topN(ugcIslands.map((i: any) => ({ ...i, ...enriched.find((e: any) => e.island_code === i.island_code) })), "week_peak_ccu_max", 10),
        topUniquePlayers: topN(enriched, "week_unique", 10),
        topTotalPlays: topN(enriched, "week_plays", 10),
        topMinutesPlayed: topN(enriched, "week_minutes", 10),
        topRetentionD1: topN(enriched, "week_d1_avg", 10),
        topRetentionD7: topN(enriched, "week_d7_avg", 10),
        topD1_UGC: topN(ugcIslands, "week_d1_avg", 10),
        topD7_UGC: topN(ugcIslands, "week_d7_avg", 10),
        topCreatorsByPlays: topN(creators, "totalPlays", 10),
        topCreatorsByPlayers: topN(creators, "uniquePlayers", 10),
        topCreatorsByMinutes: topN(creators, "minutesPlayed", 10),
        topCreatorsByCCU: topN(creators, "peakCCU", 10),
        topCreatorsByD1: topN(creators, "avgD1", 10),
        topCreatorsByD7: topN(creators, "avgD7", 10),
        topAvgMinutesPerPlayer: topN(enriched, "week_minutes_per_player_avg", 10),
        topFavorites: topN(enriched, "week_favorites", 10),
        topRecommendations: topN(enriched, "week_recommends", 10),
        topPlaysPerPlayer: topN(enriched, "playsPerPlayer", 10),
        topFavsPer100: topN(enriched, "favPer100", 10),
        topRecPer100: topN(enriched, "recPer100", 10),
        topRetentionAdjD1: topN(enriched, "retentionAdjD1", 10),
        topRetentionAdjD7: topN(enriched, "retentionAdjD7", 10),
        categoryShare: categories.sort((a: any, b: any) => b.totalPlays - a.totalPlays).slice(0, 15),
        categoryPopularity: Object.fromEntries(
          categories.sort((a: any, b: any) => b.maps - a.maps).slice(0, 10).map((c: any) => [c.title || c.category, c.maps])
        ),
        topCategoriesByPlays: topN(categories, "totalPlays", 10),
        topCategoriesByPlayers: topN(categories, "uniquePlayers", 10),
        topTags,
        topFavsPerPlay: topN(enriched, "favToPlayRatio", 10),
        topRecsPerPlay: topN(enriched, "recToPlayRatio", 10),
        trendingTopics,
        topNewIslandsByPlays: topN(newIslandsReported, "week_plays", 10),
        topNewIslandsByPlayers: topN(newIslandsReported, "week_unique", 10),
        topNewIslandsByCCU: topN(newIslandsReported, "week_peak_ccu_max", 10),
        failedIslandsList: failedIslands
          .sort((a: any, b: any) => (a.week_unique || 0) - (b.week_unique || 0))
          .slice(0, 10)
          .map((i: any) => ({
            code: i.island_code,
            title: i.title,
            creator: i.creator_code,
            category: i.category,
            value: i.week_unique || 0,
            name: i.title || i.island_code,
          })),
        // Phase 2 new rankings
        topRisers,
        topDecliners,
        breakouts,
        revivedIslands: revivedIslands.sort((a, b) => b.value - a.value).slice(0, 10),
        deadIslands: deadIslands.sort((a, b) => b.value - a.value).slice(0, 10),
      };

      // Update discover_islands cache (metadata only — metrics already written in metrics mode)
      const cacheMetaUpserts = islands.map((i: any) => ({
        island_code: i.island_code,
        title: i.title,
        creator_code: i.creator_code,
        category: i.category,
        tags: i.tags,
        created_in: i.created_in,
      }));
      for (let i = 0; i < cacheMetaUpserts.length; i += 100) {
        await supabase.from("discover_islands").upsert(cacheMetaUpserts.slice(i, i + 100), { onConflict: "island_code" });
      }

      await supabase.from("discover_reports").update({
        phase: "ai",
        progress_pct: 95,
        computed_rankings: computedRankings,
        platform_kpis: platformKPIs,
        island_count: islands.length,
        status: "analyzing",
      }).eq("id", reportId);

      console.log(`[finalize] Done. ${islands.length} reported, ${suppressedCount} suppressed, ${revivedIslands.length} revived, ${deadIslands.length} dead, ${topRisers.length} risers, ${topDecliners.length} decliners`);

      return new Response(JSON.stringify({
        success: true, phase: "ai", progress_pct: 95,
        reported_count: islands.length,
        suppressed_count: suppressedCount,
        revived_count: revivedIslands.length,
        dead_count: deadIslands.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown mode: ${mode}`);
  } catch (e) {
    console.error("Collector error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
