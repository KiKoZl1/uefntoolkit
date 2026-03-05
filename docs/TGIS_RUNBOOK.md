# TGIS Runbook (Nano Banana Production)

## Goal
Operate TGIS generation in production using `fal-ai/nano-banana-2/edit`, with:
1. `num_images` fixed at `1`
2. dynamic reference slots (`skin1`, `skin2`, optional user ref, remaining cluster refs)
3. mandatory normalized output `1920x1080` stored in `tgis-generated`
4. no LoRA dependency for runtime generation

## Required Environment
1. `SUPABASE_URL`
2. `SUPABASE_ANON_KEY`
3. `SUPABASE_SERVICE_ROLE_KEY`
4. `SUPABASE_DB_URL` (for local scripts)
5. `FAL_API_KEY` (or `FAL_KEY`)

## Deploy Order
1. Apply DB migrations:
```bash
supabase db push
```
2. Deploy edge functions:
```bash
supabase functions deploy tgis-generate
supabase functions deploy tgis-skins-search
supabase functions deploy tgis-health
```

## Hard Reset (Phase 1)
Run once before Nano go-live:
```bash
python -m ml.tgis.runtime.reset_tgis_nano_state --config ml/tgis/configs/base.yaml --yes-i-know --clean-local-artifacts
```

This resets:
1. `tgis_training_runs`
2. `tgis_model_versions`
3. `tgis_generation_log`
4. `tgis_prompt_rewrite_log`
5. `tgis_cost_usage_daily`
6. `tgis_skin_usage_daily`
7. local train/caption artifacts

Keeps:
1. `tgis_cluster_registry`
2. `tgis_reference_images`
3. taxonomy/merge rules

## Recluster V3 (metadata-first + p70 quality)
```bash
python -m ml.tgis.pipelines.recluster_v3 --config ml/tgis/configs/base.yaml --quality-percentile 0.70 --small-cluster-threshold 50
python -m ml.tgis.pipelines.sync_cluster_registry_v2 --config ml/tgis/configs/base.yaml --input ml/tgis/artifacts/clusters_v3.csv
python -m ml.tgis.pipelines.manifest_writer --config ml/tgis/configs/base.yaml
```

Generated artifacts:
1. `ml/tgis/artifacts/clusters_v3.csv`
2. `ml/tgis/artifacts/cluster_purity_report_v3.json`
3. `ml/tgis/artifacts/cluster_size_report_v3.json`
4. `ml/tgis/artifacts/cluster_conflicts_v3.csv` (only if conflict exists)

Gate:
1. `conflicting_pairs = 0`
2. purity target `>= 0.90`
3. clusters `< 50` rows marked for manual merge

## Runtime Generation Flow
1. Frontend sends `prompt`, `tags`, optional `mapTitle`, `cameraAngle`, `moodOverride`, `skinIds`, `referenceImageUrl`, `contextBoost`
2. `tgis-generate` routes `cluster_slug` by taxonomy rules + keyword fallback
3. refs are assembled in fixed order:
1. skins (max 2)
2. user reference (0/1)
3. cluster refs (remaining slots up to 14)
4. Nano Banana is called with:
1. `resolution: "2K"`
2. `aspect_ratio: "16:9"`
3. `num_images: 1`
4. `enable_web_search: contextBoost`
5. result is normalized and stored in `tgis-generated/final/..._1920x1080.png`

## Skins Strategy
1. No full skins catalog in DB
2. Search endpoint: `tgis-skins-search` proxies `fortnite-api.com`
3. usage ranking stored only in `tgis_skin_usage_daily`
4. counter increments on successful generation when skins are used

## Retention Policy
1. `tgis_cleanup_logs_30d()` removes generation + rewrite logs older than 30 days
2. cron `tgis-log-retention-30d` runs daily

Manual execution:
```sql
select public.tgis_cleanup_logs_30d();
```

## Smoke Test
```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/tgis-generate" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt":"fortnite thumbnail with intense 1v1 action",
    "tags":["1v1","zonewars"],
    "cameraAngle":"eye",
    "contextBoost":true
  }'
```

Expect:
1. `success: true`
2. `image.width = 1920`
3. `image.height = 1080`
4. `normalized_image_url` populated in `tgis_generation_log`

## Troubleshooting
1. `missing_tags`: frontend did not send tags array
2. `invalid_reference_image_url`: user URL not in whitelist
3. `no_reference_image_available`: cluster refs empty and no fallback available
4. `nano_http_*`: upstream fal request failed
5. `final_dimension_mismatch`: normalization pipeline failed to produce 1920x1080
