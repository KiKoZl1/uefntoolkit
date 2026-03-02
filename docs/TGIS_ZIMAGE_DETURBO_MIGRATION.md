# TGIS Migration: Z-Image-Turbo -> Z-Image-De-Turbo

Date: 2026-03-01

## Why we migrated
Training with `Tongyi-MAI/Z-Image-Turbo` + adapter repeatedly failed in the current AI Toolkit stack with:
1. meta tensor load errors,
2. adapter key mismatch in low-vram path,
3. unstable behavior across pod restarts.

## New model strategy
Use a "complete" local model folder:
1. Base components from `Tongyi-MAI/Z-Image-Turbo`:
   - `model_index.json`
   - `tokenizer/*`
   - `text_encoder/*`
   - `vae/*`
2. Transformer from `ostris/Z-Image-De-Turbo`:
   - `transformer/*`

Final folder:
`/workspace/models/Z-Image-De-Turbo-Complete`

## Config changes
Training model block now:
```yaml
model:
  name_or_path: /workspace/models/Z-Image-De-Turbo-Complete
  arch: zimage
  is_flux: false
  quantize: false
  low_vram: true
```

Important:
1. `assistant_lora_path` removed.
2. `arch: zimage` is mandatory, otherwise AI Toolkit falls back to legacy loader.
3. Single training bucket resolution is used (`train_resolution`) to avoid duplicate latent cache passes.
4. For 24GB GPUs, use stable defaults: `train_resolution=1024`, `network_linear=8`, `network_linear_alpha=8`, `low_vram=true`.

## Practical outcomes
1. Smoke training reaches checkpoint save successfully.
2. No adapter dependency in training path.
3. Repeatable setup with lower operational risk per new pod.
4. Real training no longer fails with early OOM when the 24GB profile is applied.

## References
1. https://huggingface.co/ostris/Z-Image-De-Turbo
2. https://huggingface.co/ostris/Z-Image-De-Turbo/discussions/2
3. https://github.com/ostris/ai-toolkit/issues/590
