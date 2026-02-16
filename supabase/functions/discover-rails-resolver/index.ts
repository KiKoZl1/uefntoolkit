import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

function edgePriority(edgeType: string): number {
  if (edgeType === "default_sub_link_code") return 0;
  if (edgeType === "sub_link_code") return 1;
  if (edgeType === "related_link") return 2;
  if (edgeType === "fallback_link") return 3;
  if (edgeType === "parent_link") return 9;
  return 5;
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

    const region = String(body.region || "NAE");
    const surfaceName = String(body.surfaceName || "CreativeDiscoverySurface_Frontend");
    const maxPanels = Math.max(1, Math.min(100, Number(body.maxPanels ?? 40)));
    const maxItemsPerPanel = Math.max(1, Math.min(250, Number(body.maxItemsPerPanel ?? 60)));
    const maxChildrenPerCollection = Math.max(1, Math.min(200, Number(body.maxChildrenPerCollection ?? 40)));
    const includeChildren = body.includeChildren != null ? Boolean(body.includeChildren) : true;

    const { data: targetRows, error: tErr } = await supabase
      .from("discovery_exposure_targets")
      .select("id,region,surface_name,platform,locale,last_ok_tick_at")
      .eq("region", region)
      .eq("surface_name", surfaceName)
      .order("last_ok_tick_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (tErr) throw new Error(tErr.message);
    if (!targetRows || targetRows.length === 0) {
      return json({ success: false, error: "target not found" }, 404);
    }
    const target = targetRows[0] as any;
    const targetId = String(target.id);

    // Current open rank segments represent the latest panel state snapshot.
    const { data: segs, error: sErr } = await supabase
      .from("discovery_exposure_rank_segments")
      .select("target_id,surface_name,panel_name,panel_display_name,panel_type,feature_tags,rank,link_code,link_code_type,ccu_max,ccu_end,last_seen_ts")
      .eq("target_id", targetId)
      .is("end_ts", null)
      .order("panel_name", { ascending: true })
      .order("rank", { ascending: true })
      .limit(maxPanels * maxItemsPerPanel + 500);
    if (sErr) throw new Error(sErr.message);

    const rows = (segs || []) as any[];
    if (!rows.length) {
      return json({
        success: true,
        target,
        rails: [],
        meta: { region, surfaceName, targetId, generatedAt: new Date().toISOString() },
      });
    }

    const allTopCodes = Array.from(new Set(rows.map((r) => String(r.link_code))));
    const collectionCodes = Array.from(
      new Set(rows.filter((r) => String(r.link_code_type) === "collection").map((r) => String(r.link_code))),
    );

    const metaMap = new Map<string, any>();
    for (let i = 0; i < allTopCodes.length; i += 1000) {
      const chunk = allTopCodes.slice(i, i + 1000);
      const { data, error } = await supabase
        .from("discover_link_metadata")
        .select("link_code,title,image_url,support_code,link_type")
        .in("link_code", chunk);
      if (error) throw new Error(error.message);
      for (const r of data || []) metaMap.set(String((r as any).link_code), r);
    }

    const currentCcuMap = new Map<string, number | null>();
    {
      const { data, error } = await supabase
        .from("discovery_exposure_rank_segments")
        .select("link_code,ccu_max,ccu_end")
        .eq("target_id", targetId)
        .is("end_ts", null)
        .in("link_code", allTopCodes);
      if (!error) {
        for (const r of data || []) {
          const code = String((r as any).link_code);
          const ccu = (r as any).ccu_end ?? (r as any).ccu_max ?? null;
          currentCcuMap.set(code, ccu != null ? Number(ccu) : null);
        }
      }
    }

    // Resolve children for collection links via discover_link_edges.
    const edgesByParent = new Map<string, any[]>();
    if (includeChildren && collectionCodes.length) {
      const { data: edges, error: eErr } = await supabase
        .from("discover_link_edges")
        .select("parent_link_code,child_link_code,edge_type,sort_order,last_seen_at")
        .in("parent_link_code", collectionCodes);
      if (!eErr) {
        for (const e of edges || []) {
          const parent = String((e as any).parent_link_code);
          const arr = edgesByParent.get(parent) || [];
          arr.push(e);
          edgesByParent.set(parent, arr);
        }
        for (const [p, arr] of edgesByParent.entries()) {
          arr.sort((a: any, b: any) => {
            const ep = edgePriority(String(a.edge_type)) - edgePriority(String(b.edge_type));
            if (ep !== 0) return ep;
            const sa = a.sort_order == null ? 999999 : Number(a.sort_order);
            const sb = b.sort_order == null ? 999999 : Number(b.sort_order);
            if (sa !== sb) return sa - sb;
            return String(a.child_link_code).localeCompare(String(b.child_link_code));
          });
          edgesByParent.set(p, arr);
        }
      }
    }

    const childCodes = Array.from(
      new Set(
        Array.from(edgesByParent.values())
          .flat()
          .map((e: any) => String(e.child_link_code)),
      ),
    );

    if (childCodes.length) {
      for (let i = 0; i < childCodes.length; i += 1000) {
        const chunk = childCodes.slice(i, i + 1000);
        const { data, error } = await supabase
          .from("discover_link_metadata")
          .select("link_code,title,image_url,support_code,link_type")
          .in("link_code", chunk);
        if (error) throw new Error(error.message);
        for (const r of data || []) metaMap.set(String((r as any).link_code), r);
      }

      const { data: childSegs, error: csErr } = await supabase
        .from("discovery_exposure_rank_segments")
        .select("link_code,ccu_max,ccu_end")
        .eq("target_id", targetId)
        .is("end_ts", null)
        .in("link_code", childCodes);
      if (!csErr) {
        for (const r of childSegs || []) {
          const code = String((r as any).link_code);
          const ccu = (r as any).ccu_end ?? (r as any).ccu_max ?? null;
          const prev = currentCcuMap.get(code);
          if (prev == null && ccu != null) currentCcuMap.set(code, Number(ccu));
          else if (prev != null && ccu != null) currentCcuMap.set(code, Math.max(prev, Number(ccu)));
        }
      }
    }

    // Build rails grouped by panel.
    const panelOrder = Array.from(new Set(rows.map((r) => String(r.panel_name)))).slice(0, maxPanels);
    const rails = panelOrder.map((panelName) => {
      const panelRows = rows
        .filter((r) => String(r.panel_name) === panelName)
        .sort((a, b) => Number(a.rank) - Number(b.rank))
        .slice(0, maxItemsPerPanel);

      const first = panelRows[0] || {};
      const items = panelRows.map((r: any) => {
        const code = String(r.link_code);
        const m = metaMap.get(code) || {};
        const base = {
          rank: Number(r.rank),
          linkCode: code,
          linkCodeType: String(r.link_code_type),
          title: m.title ?? code,
          imageUrl: m.image_url ?? null,
          creatorCode: m.support_code ?? null,
          linkType: m.link_type ?? null,
          ccu: currentCcuMap.get(code) ?? (r.ccu_end != null ? Number(r.ccu_end) : (r.ccu_max != null ? Number(r.ccu_max) : null)),
        } as any;

        if (includeChildren && String(r.link_code_type) === "collection") {
          const edges = edgesByParent.get(code) || [];
          const seen = new Set<string>();
          const children = [];
          for (const e of edges) {
            const childCode = String((e as any).child_link_code);
            if (seen.has(childCode)) continue;
            seen.add(childCode);
            const cm = metaMap.get(childCode) || {};
            children.push({
              linkCode: childCode,
              title: cm.title ?? childCode,
              imageUrl: cm.image_url ?? null,
              creatorCode: cm.support_code ?? null,
              linkType: cm.link_type ?? null,
              ccu: currentCcuMap.get(childCode) ?? null,
              edgeType: (e as any).edge_type ?? null,
              sortOrder: (e as any).sort_order ?? null,
            });
            if (children.length >= maxChildrenPerCollection) break;
          }
          base.children = children;
          base.childrenCount = children.length;
        }

        return base;
      });

      return {
        panelName,
        panelDisplayName: first.panel_display_name ?? panelName,
        panelType: first.panel_type ?? null,
        featureTags: first.feature_tags ?? null,
        items,
      };
    });

    return json({
      success: true,
      meta: {
        generatedAt: new Date().toISOString(),
        region,
        surfaceName,
        targetId,
        targetLastOkTickAt: target.last_ok_tick_at ?? null,
        rails: rails.length,
      },
      rails,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

