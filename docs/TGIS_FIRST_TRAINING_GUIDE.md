# TGIS First Nano Generation Guide

Legacy training UI still exists in admin, but production generation is now Nano Banana based.
Use this guide as the first operational checklist after setup/reset.

## 1) Prepare env
```bash
cd c:/DEV/Surprise/epic-insight-engine
```

Required env:
1. `SUPABASE_URL`
2. `SUPABASE_ANON_KEY`
3. `SUPABASE_SERVICE_ROLE_KEY`
4. `SUPABASE_DB_URL`
5. `FAL_API_KEY`

## 2) Apply schema + deploy functions
```bash
supabase db push
supabase functions deploy tgis-generate
supabase functions deploy tgis-skins-search
supabase functions deploy tgis-health
```

## 3) Run hard reset (once, before first Nano validation)
```bash
python -m ml.tgis.runtime.reset_tgis_nano_state --config ml/tgis/configs/base.yaml --yes-i-know --clean-local-artifacts
```

## 4) Regenerate clusters V3
```bash
python -m ml.tgis.pipelines.recluster_v3 --config ml/tgis/configs/base.yaml --quality-percentile 0.70 --small-cluster-threshold 50
python -m ml.tgis.pipelines.sync_cluster_registry_v2 --config ml/tgis/configs/base.yaml --input ml/tgis/artifacts/clusters_v3.csv
python -m ml.tgis.pipelines.reference_sync --config ml/tgis/configs/base.yaml --top-n 20
python -m ml.tgis.pipelines.manifest_writer --config ml/tgis/configs/base.yaml
```

Validate:
1. `cluster_conflicts_v3.csv` does not exist (or empty)
2. purity report target near/above 0.90 for approved clusters

## 5) Smoke generation
```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/tgis-generate" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt":"fortnite creative thumbnail, intense combat",
    "tags":["combat","1v1","zonewars"],
    "cameraAngle":"eye",
    "contextBoost":true
  }'
```

Expected:
1. `success=true`
2. `image.width=1920`
3. `image.height=1080`
4. `normalized_image_url` filled in DB

## 6) Frontend smoke
1. Open `/thumb-generator`
2. Enter prompt + tags
3. Optional: search/select up to 2 skins
4. Optional: upload reference image
5. Generate
6. Confirm result metadata (cluster, cost, latency, slots)

## 7) Operational checks
```sql
select id, status, cluster_slug, normalized_image_url, normalized_width, normalized_height, error_text
from public.tgis_generation_log
order by created_at desc
limit 20;
```

```sql
select date, skin_id, count
from public.tgis_skin_usage_daily
order by date desc, count desc
limit 20;
```
