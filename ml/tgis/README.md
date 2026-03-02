# TGIS ML Workspace

Operational ML layer for TGIS (Thumbnail Generation Intelligence System).

## Scope
1. Curate thumbnail dataset from platform signals.
2. Run cloud visual clustering.
3. Generate training captions and manifests.
4. Train LoRA per cluster on RunPod.
5. Register model versions and apply quality gates.

## Current Training Baseline
1. Model path: `/workspace/models/Z-Image-De-Turbo-Complete`
2. Required model config:
   - `arch: zimage`
   - `is_flux: false`
   - `quantize: false`
   - no `assistant_lora_path`
3. 24GB-safe defaults:
   - `train.train_resolution: 1024`
   - `train.network_linear: 8`
   - `train.network_linear_alpha: 8`
   - `train.low_vram: true`
4. Product output policy remains `1920x1080`.

## Key Files
1. `ml/tgis/configs/base.yaml`
2. `ml/tgis/pipelines/config_generator.py`
3. `ml/tgis/train/runpod_train_cluster.py`
4. `ml/tgis/train/preflight_check.py`
5. `scripts/setup_tgis.sh`

## Minimal End-to-End Commands
```bash
# 1) Build visual pool and export cloud manifest
python -m ml.tgis.pipelines.build_visual_pool_ab --config ml/tgis/configs/base.yaml --min-unique-players 50 --window-days 14
python -m ml.tgis.pipelines.export_cloud_manifest --config ml/tgis/configs/base.yaml

# 2) Apply cloud clusters and prepare train datasets
python -m ml.tgis.pipelines.apply_visual_clusters --config ml/tgis/configs/base.yaml --input ml/tgis/artifacts/cloud/visual_clusters.csv
python -m ml.tgis.pipelines.thumb_downloader --config ml/tgis/configs/base.yaml --max-total 30000 --max-per-cluster 10000
python -m ml.tgis.pipelines.thumb_captioner --config ml/tgis/configs/base.yaml
python -m ml.tgis.pipelines.config_generator --config ml/tgis/configs/base.yaml
python -m ml.tgis.pipelines.manifest_writer --config ml/tgis/configs/base.yaml

# 3) Preflight and train
python -m ml.tgis.train.preflight_check --config ml/tgis/configs/base.yaml
python -m ml.tgis.train.runpod_train_cluster --config ml/tgis/configs/base.yaml --cluster-id 1 --smoke --smoke-steps 10 --target-version v1.0.0-smoke
python -m ml.tgis.train.runpod_train_cluster --config ml/tgis/configs/base.yaml --cluster-id 1 --target-version v1.0.0
```

## Deploy Notes
1. Use `ml/tgis/deploy/worker.env.example` as template.
2. Use Supabase pooler DB URL (`aws-...pooler.supabase.com:5432`) for IPv4 compatibility.
3. Use `scripts/setup_tgis.sh --setup-aitk` on every new pod.
