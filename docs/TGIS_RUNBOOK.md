# TGIS Runbook v2 (De-Turbo)

## Goal
Operate TGIS training and runtime with a repeatable flow, minimal pod drift, and clear rollback points.

## Locked Decisions
1. Training base: `ostris/Z-Image-De-Turbo` merged with `Tongyi-MAI/Z-Image-Turbo` components.
2. No `assistant_lora_path` in training configs.
3. Model config uses `arch: zimage` and `is_flux: false`.
4. Training bucket uses a single value (`train_resolution`) to avoid double latent-cache passes.
5. Default 24GB training profile: `network_linear=8`, `network_linear_alpha=8`, `train_resolution=1024`, `low_vram=true`.
6. Final product output policy is `1920x1080` for user thumbnails.

## Prerequisites
1. TGIS migrations and edge functions are deployed.
2. `ml/tgis/deploy/worker.env` exists and all keys are valid.
3. RunPod pod is attached to the correct network volume.

## New Pod Bootstrap
Run in this exact order.

1. Upload latest files from local repo to pod:
`scripts/setup_tgis.sh`, `ml/tgis/configs/base.yaml`, `ml/tgis/pipelines/config_generator.py`.
2. Move script to project and make executable.
3. Run:
```bash
bash scripts/setup_tgis.sh --setup-aitk
```
4. Validate:
```bash
source /workspace/.venv_tgis/bin/activate
cd /workspace/epic-insight-engine
set -a; source ml/tgis/deploy/worker.env; set +a
python -m ml.tgis.train.preflight_check --config ml/tgis/configs/base.yaml
```

## Build De-Turbo Complete Model Folder
Use minimal downloads only.

```bash
source /workspace/.venv_aitk/bin/activate
mkdir -p /workspace/models/Z-Image-De-Turbo-Complete

hf download Tongyi-MAI/Z-Image-Turbo \
  --local-dir /workspace/models/Z-Image-De-Turbo-Complete \
  --include "model_index.json"

hf download Tongyi-MAI/Z-Image-Turbo \
  --local-dir /workspace/models/Z-Image-De-Turbo-Complete \
  --include "tokenizer/**"

hf download Tongyi-MAI/Z-Image-Turbo \
  --local-dir /workspace/models/Z-Image-De-Turbo-Complete \
  --include "text_encoder/**"

hf download Tongyi-MAI/Z-Image-Turbo \
  --local-dir /workspace/models/Z-Image-De-Turbo-Complete \
  --include "vae/**"

hf download ostris/Z-Image-De-Turbo \
  --local-dir /workspace/models/Z-Image-De-Turbo-Complete \
  --include "transformer/**"
```

Sanity check:
```bash
find /workspace/models/Z-Image-De-Turbo-Complete -maxdepth 2 -type d | sort
```
Expected folders: `tokenizer`, `text_encoder`, `vae`, `transformer`.

## Generate Training Configs
```bash
source /workspace/.venv_tgis/bin/activate
cd /workspace/epic-insight-engine
python -m ml.tgis.pipelines.config_generator --config ml/tgis/configs/base.yaml
```

Validate cluster config:
```bash
sed -n '1,200p' ml/tgis/artifacts/train_configs/cluster_01.yaml | \
egrep "name_or_path|arch|is_flux|quantize|assistant_lora_path|resolution|save_every|dtype|lr:"
```

Expected:
1. `name_or_path: /workspace/models/Z-Image-De-Turbo-Complete`
2. `arch: zimage`
3. `is_flux: false`
4. `quantize: false`
5. No `assistant_lora_path`
6. `resolution: [1024]` (single value)
7. `low_vram: true`
8. `linear: 8` and `linear_alpha: 8`

## Smoke Test
```bash
python -m ml.tgis.train.runpod_train_cluster \
  --config ml/tgis/configs/base.yaml \
  --cluster-id 1 \
  --smoke \
  --smoke-steps 10 \
  --target-version v1.0.0-smoke
```

Success criteria:
1. Checkpoint saved under `ml/tgis/artifacts/train_output/tgis_cluster_combat_smoke/`.
2. DB row in `tgis_training_runs` is `status='success'`.

## Real Training (Cluster 01)
```bash
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
python -m ml.tgis.train.runpod_train_cluster \
  --config ml/tgis/configs/base.yaml \
  --cluster-id 1 \
  --target-version v1.0.0
```

## OOM Recovery (24GB)
If training aborts with `OOM during training step 3 times in a row`, enforce:
1. `train_resolution: 1024`
2. `network_linear: 8`
3. `network_linear_alpha: 8`
4. `low_vram: true`
5. `export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`

## Stale Running Cleanup (DB)
```sql
update public.tgis_training_runs
set status='failed', ended_at=now(), updated_at=now(), error_text='stale_running_cleanup'
where status='running' and ended_at is null and started_at < now() - interval '10 minutes';
```

## Cost and Disk Hygiene
1. Stop failed downloads:
```bash
pkill -f "hf download" || true
pkill -f "huggingface-cli download" || true
```
2. Remove partial files:
```bash
find /workspace/models -type f \( -name "*.incomplete" -o -name "*.lock" \) -delete
```
3. Check usage:
```bash
du -h --max-depth=1 /workspace | sort -hr | head -n 20
df -h /workspace
```

## Pod to Repo Sync Checklist
After successful training changes made in pod:
1. Copy changed code/docs back to local repo with `scp`.
2. Regenerate configs locally to match current `base.yaml`.
3. Commit:
   - `ml/tgis/configs/base.yaml`
   - `ml/tgis/pipelines/config_generator.py`
   - docs updates
4. Do not commit transient artifacts (`train_output`, caches, tgz files).

### SCP Template (pod -> local)
```powershell
cd C:\DEV\Surprise\epic-insight-engine
scp -P <POD_PORT> -i "$env:USERPROFILE\.ssh\id_ed25519_runpod" root@<POD_IP>:/workspace/epic-insight-engine/ml/tgis/configs/base.yaml .\ml\tgis\configs\base.yaml
scp -P <POD_PORT> -i "$env:USERPROFILE\.ssh\id_ed25519_runpod" root@<POD_IP>:/workspace/epic-insight-engine/ml/tgis/pipelines/config_generator.py .\ml\tgis\pipelines\config_generator.py
scp -P <POD_PORT> -i "$env:USERPROFILE\.ssh\id_ed25519_runpod" root@<POD_IP>:/workspace/epic-insight-engine/ml/tgis/deploy/worker.env.example .\ml\tgis\deploy\worker.env.example
```

## Production Note
Training resolution and inference output resolution are different concerns:
1. Training uses bucketed resolution for stability and VRAM control.
2. Runtime generation must return `1920x1080` in final user-facing output.
