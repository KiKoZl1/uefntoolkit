# TGIS ML Workspace

Operational ML/data layer for TGIS.

## Current Production Direction
1. Generation provider: `fal-ai/nano-banana-2/edit`
2. Runtime output policy: always `1920x1080`
3. Variants: fixed `1` image per request
4. Dynamic references: skins + optional user ref + cluster refs
5. LoRA training path remains in repo as legacy/optional, not the runtime default

## Core Pipelines
1. Build and refresh dataset candidates: `thumb_pipeline.py`
2. Metadata-first reclustering V3: `recluster_v3.py`
3. Registry sync after recluster: `sync_cluster_registry_v2.py`
4. Top reference sync: `reference_sync.py`

## Hard Reset Script (Nano baseline)
```bash
python -m ml.tgis.runtime.reset_tgis_nano_state --config ml/tgis/configs/base.yaml --yes-i-know --clean-local-artifacts
```

## Recluster V3
```bash
python -m ml.tgis.pipelines.recluster_v3 --config ml/tgis/configs/base.yaml --quality-percentile 0.70 --small-cluster-threshold 50
python -m ml.tgis.pipelines.sync_cluster_registry_v2 --config ml/tgis/configs/base.yaml --input ml/tgis/artifacts/clusters_v3.csv
python -m ml.tgis.pipelines.reference_sync --config ml/tgis/configs/base.yaml --top-n 20
python -m ml.tgis.pipelines.manifest_writer --config ml/tgis/configs/base.yaml
```

## Artifacts
Main V3 outputs:
1. `ml/tgis/artifacts/clusters_v3.csv`
2. `ml/tgis/artifacts/cluster_purity_report_v3.json`
3. `ml/tgis/artifacts/cluster_size_report_v3.json`
4. `ml/tgis/artifacts/cluster_conflicts_v3.csv` (only when conflict exists)

## Notes
1. No hardcoded cluster names are required in V3 generation flow.
2. A single `(link_code,image_url)` must never map to multiple clusters.
3. Log retention policy is 30 days (`tgis_cleanup_logs_30d`).
