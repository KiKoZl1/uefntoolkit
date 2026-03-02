# TGIS First Training Guide

This is the shortest safe path from fresh pod to first successful training run.

## 1) Start pod and bootstrap environment
```bash
cd /workspace/epic-insight-engine
bash scripts/setup_tgis.sh --setup-aitk
```

## 2) Build De-Turbo complete model folder
```bash
source /workspace/.venv_aitk/bin/activate
mkdir -p /workspace/models/Z-Image-De-Turbo-Complete

hf download Tongyi-MAI/Z-Image-Turbo --local-dir /workspace/models/Z-Image-De-Turbo-Complete --include "model_index.json"
hf download Tongyi-MAI/Z-Image-Turbo --local-dir /workspace/models/Z-Image-De-Turbo-Complete --include "tokenizer/**"
hf download Tongyi-MAI/Z-Image-Turbo --local-dir /workspace/models/Z-Image-De-Turbo-Complete --include "text_encoder/**"
hf download Tongyi-MAI/Z-Image-Turbo --local-dir /workspace/models/Z-Image-De-Turbo-Complete --include "vae/**"
hf download ostris/Z-Image-De-Turbo --local-dir /workspace/models/Z-Image-De-Turbo-Complete --include "transformer/**"
```

Validate:
```bash
find /workspace/models/Z-Image-De-Turbo-Complete -maxdepth 2 -type d | sort
```

## 3) Generate configs
```bash
source /workspace/.venv_tgis/bin/activate
cd /workspace/epic-insight-engine
set -a; source ml/tgis/deploy/worker.env; set +a

python -m ml.tgis.pipelines.config_generator --config ml/tgis/configs/base.yaml
```

Validate:
```bash
sed -n '1,180p' ml/tgis/artifacts/train_configs/cluster_01.yaml | \
egrep "name_or_path|arch|is_flux|quantize|assistant_lora_path|resolution|save_every|dtype|lr:"
```

Expected minimum:
1. `name_or_path: /workspace/models/Z-Image-De-Turbo-Complete`
2. `arch: zimage`
3. `is_flux: false`
4. `quantize: false`
5. no `assistant_lora_path`
6. single `resolution: [1024]`
7. `low_vram: true`
8. `linear: 8` and `linear_alpha: 8`

## 4) Smoke test
```bash
python -m ml.tgis.train.runpod_train_cluster \
  --config ml/tgis/configs/base.yaml \
  --cluster-id 1 \
  --smoke \
  --smoke-steps 10 \
  --target-version v1.0.0-smoke
```

## 5) Real train for first cluster
```bash
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
python -m ml.tgis.train.runpod_train_cluster \
  --config ml/tgis/configs/base.yaml \
  --cluster-id 1 \
  --target-version v1.0.0
```

## 6) Register and evaluate
1. Register candidate model in DB (`lora_uploader`).
2. Run strict quality gate (`quality_eval`).
3. Promote only if gate passes.

## 7) Operational reminders
1. Keep beta closed while calibrating cost and quality.
2. Final user output policy is always `1920x1080`.
3. Do not commit transient artifacts or cache directories.
