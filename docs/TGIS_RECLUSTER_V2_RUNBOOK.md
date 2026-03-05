# TGIS Recluster V2 Runbook

## 1) Snapshot before reset

```bash
python -m ml.tgis.runtime.snapshot_tgis_state --config ml/tgis/configs/base.yaml --generation-days 30
```

## 2) Controlled reset (destructive)

```bash
python -m ml.tgis.runtime.reset_tgis_v2_state \
  --config ml/tgis/configs/base.yaml \
  --clean-local-artifacts \
  --yes-i-know
```

## 3) Recluster phase 1 (keyword-first)

```bash
python -m ml.tgis.pipelines.recluster_keywords --config ml/tgis/configs/base.yaml
```

Outputs:
- `ml/tgis/artifacts/clusters_v2_keyword.csv`
- `ml/tgis/artifacts/cluster_purity_report_v2_keyword.json`
- `ml/tgis/artifacts/cluster_size_report_v2_keyword.json`

## 4) Recluster phase 2 (misc visual, manual)

```bash
python -m ml.tgis.pipelines.recluster_misc_visual --config ml/tgis/configs/base.yaml
```

Output:
- `ml/tgis/artifacts/clusters_v2_misc.csv`

## 5) Recluster phase 2.5 (misc vision, manual optional)

```bash
python -m ml.tgis.pipelines.recluster_misc_vision \
  --config ml/tgis/configs/base.yaml \
  --max-images 250
```

To apply vision suggestions automatically to misc rows:

```bash
python -m ml.tgis.pipelines.recluster_misc_vision \
  --config ml/tgis/configs/base.yaml \
  --max-images 250 \
  --apply-suggestions
```

## 6) Phase 3 (manual merge)

### Option A: rules from DB (`public.tgis_cluster_merge_rules`)

```bash
python -m ml.tgis.pipelines.apply_cluster_merges --config ml/tgis/configs/base.yaml
```

### Option B: rules from local YAML

```bash
python -m ml.tgis.pipelines.apply_cluster_merges \
  --config ml/tgis/configs/base.yaml \
  --rules-yaml ml/tgis/artifacts/cluster_merge_rules.yml
```

Final output:
- `ml/tgis/artifacts/clusters_v2.csv`

## 7) Sync registry (slug/family/routing tags)

```bash
python -m ml.tgis.pipelines.sync_cluster_registry_v2 --config ml/tgis/configs/base.yaml
```

Optional (deactivate missing clusters):

```bash
python -m ml.tgis.pipelines.sync_cluster_registry_v2 \
  --config ml/tgis/configs/base.yaml \
  --deactivate-missing
```

## 8) Regenerate captions after final clustering

```bash
python -m ml.tgis.pipelines.thumb_captioner \
  --config ml/tgis/configs/base.yaml \
  --input ml/tgis/artifacts/clusters_v2.csv \
  --output-csv ml/tgis/artifacts/training_metadata_v2.csv \
  --output-jsonl ml/tgis/artifacts/captions_v2.jsonl \
  --dataset-dir ml/tgis/artifacts/train_datasets_v2
```

## 9) Gate before retrain

Manual go/no-go criteria:
- Purity >= 0.90 per validated cluster.
- No `(link_code, image_url)` conflicts across final slugs.
- `tgis_cluster_registry` synced with final V2 slugs.

Automatic gate in training worker:
- `process_training_queue` blocks non-dry-run jobs when gate artifacts are missing or below threshold.
- Defaults:
  - `recluster_min_purity = 0.90`
  - `recluster_max_misc_rate = 0.30`
  - `require_recluster_gate = true`
- Configurable via `train` section in `ml/tgis/configs/base.yaml`.
- Emergency bypass:
  - Env: `TGIS_SKIP_RECLUSTER_GATE=1`
  - Per-run payload: `skipReclusterGate=true`
