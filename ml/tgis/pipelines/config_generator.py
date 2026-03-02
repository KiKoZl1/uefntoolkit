from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import yaml

from ml.tgis.runtime import load_yaml


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate per-cluster train configs for AI Toolkit")
    p.add_argument("--config", default="ml/tgis/configs/base.yaml")
    p.add_argument("--input", default=None)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    cfg = load_yaml(args.config)
    input_path = Path(args.input or cfg.get("paths", {}).get("clusters_csv", "ml/tgis/artifacts/clusters.csv"))
    out_dir = Path(cfg.get("paths", {}).get("train_configs_dir", "ml/tgis/artifacts/train_configs"))
    thumbs_root = Path(cfg.get("paths", {}).get("artifacts", "ml/tgis/artifacts")) / "thumbs"
    dataset_root = Path(cfg.get("paths", {}).get("training_dataset_dir", "ml/tgis/artifacts/train_datasets"))
    training_folder = Path(cfg.get("paths", {}).get("train_output_dir", "ml/tgis/artifacts/train_output"))
    out_dir.mkdir(parents=True, exist_ok=True)
    training_folder.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        raise FileNotFoundError(f"clusters csv not found: {input_path}")

    df = pd.read_csv(input_path)
    active_files: set[str] = set()

    train_cfg = cfg.get("train", {})
    network_linear = int(train_cfg.get("network_linear", 16))
    network_linear_alpha = int(train_cfg.get("network_linear_alpha", 16))
    save_every = int(train_cfg.get("save_every", 250))
    max_step_saves_to_keep = int(train_cfg.get("max_step_saves_to_keep", 4))
    train_resolution = train_cfg.get("train_resolution", None)
    train_resolutions = train_cfg.get("train_resolutions", None)
    if isinstance(train_resolutions, list) and train_resolutions:
        resolution_values = [int(x) for x in train_resolutions if int(x) > 0]
    elif train_resolution is not None:
        resolution_values = [int(train_resolution)]
    else:
        # Backward-compatible fallback: use only one bucket target.
        fallback_w = int(train_cfg.get("resolution_w", 1408))
        fallback_h = int(train_cfg.get("resolution_h", 1408))
        resolution_values = [max(fallback_w, fallback_h)]
    batch_size = int(train_cfg.get("batch_size", 1))
    steps = int(train_cfg.get("steps", 2000))
    grad_accum = int(train_cfg.get("gradient_accumulation_steps", 4))
    learning_rate = float(train_cfg.get("learning_rate", 1e-4))
    train_dtype = str(train_cfg.get("train_dtype", "bf16"))
    gradient_checkpointing = bool(train_cfg.get("gradient_checkpointing", True))
    optimizer = str(train_cfg.get("optimizer", "adamw8bit"))
    lr_scheduler = str(train_cfg.get("lr_scheduler", "cosine"))
    lr_warmup_steps = int(train_cfg.get("lr_warmup_steps", 100))
    max_grad_norm = float(train_cfg.get("max_grad_norm", 1.0))
    noise_scheduler = str(train_cfg.get("noise_scheduler", "flowmatch"))
    quantize = bool(train_cfg.get("quantize", True))
    quantize_te = bool(train_cfg.get("quantize_te", quantize))
    qtype = str(train_cfg.get("qtype", "qfloat8"))
    qtype_te = str(train_cfg.get("qtype_te", qtype))
    low_vram = bool(train_cfg.get("low_vram", False))
    layer_offloading = bool(train_cfg.get("layer_offloading", False))
    model_arch = train_cfg.get("model_arch")
    adapter_path = str(train_cfg.get("adapter", "")).strip()
    include_misc = bool(train_cfg.get("include_misc", False))
    model_base = str(train_cfg.get("model_base", "Tongyi-MAI/Z-Image-Turbo"))
    model_arch_lc = str(model_arch).strip().lower() if model_arch else ""
    if model_arch_lc == "zimage":
        default_is_flux = False
    elif model_arch_lc == "flux":
        default_is_flux = True
    else:
        default_is_flux = "flux" in model_base.lower()
    is_flux = bool(train_cfg.get("is_flux", default_is_flux))

    for cluster_id, group in df.groupby("cluster_id"):
        cluster_name = str(group["cluster_name"].iloc[0])
        if not include_misc and cluster_name == "cluster_misc":
            continue
        cluster_num = int(cluster_id)
        cluster_dir = (thumbs_root / f"cluster_{cluster_num:02d}").resolve()
        metadata_jsonl = (dataset_root / f"cluster_{cluster_num:02d}" / "metadata.jsonl").resolve()
        if not metadata_jsonl.exists():
            # Skip clusters that do not have prepared caption metadata.
            continue

        model_cfg: dict[str, object] = {
            "name_or_path": model_base,
            "is_flux": is_flux,
            "quantize": quantize,
        }
        if model_arch:
            model_cfg["arch"] = str(model_arch)
        if low_vram:
            model_cfg["low_vram"] = True
        if layer_offloading:
            model_cfg["layer_offloading"] = True
        if quantize:
            model_cfg["qtype"] = qtype
            model_cfg["quantize_te"] = quantize_te
            model_cfg["qtype_te"] = qtype_te
        if adapter_path:
            model_cfg["assistant_lora_path"] = adapter_path

        # AI Toolkit config format (aligned with PRD section 8.1).
        # Dataset uses image + .txt sidecar captions (caption_ext=txt).
        per_cluster_cfg = {
            "job": "extension",
            "config": {
                "name": f"tgis_{cluster_name}",
                "process": [
                    {
                        "type": "sd_trainer",
                        "training_folder": training_folder.resolve().as_posix(),
                        "device": "cuda:0",
                        "trigger_word": f"tgis_{cluster_name}",
                        "network": {
                            "type": "lora",
                            "linear": network_linear,
                            "linear_alpha": network_linear_alpha,
                        },
                        "save": {
                            "dtype": "float16",
                            "save_every": save_every,
                            "max_step_saves_to_keep": max_step_saves_to_keep,
                        },
                        "datasets": [
                            {
                                "folder_path": cluster_dir.as_posix(),
                                "caption_ext": "txt",
                                "resolution": resolution_values,
                                "shuffle_tokens": False,
                                "cache_latents_to_disk": True,
                            }
                        ],
                        "train": {
                            "batch_size": batch_size,
                            "steps": steps,
                            "gradient_accumulation_steps": grad_accum,
                            "train_unet": True,
                            "train_text_encoder": False,
                            "gradient_checkpointing": gradient_checkpointing,
                            "dtype": train_dtype,
                            "lr": learning_rate,
                            "optimizer": optimizer,
                            "lr_scheduler": lr_scheduler,
                            "lr_warmup_steps": lr_warmup_steps,
                            "max_grad_norm": max_grad_norm,
                            "noise_scheduler": noise_scheduler,
                        },
                        "model": model_cfg,
                        "meta": {
                            "cluster_id": cluster_num,
                            "cluster_name": cluster_name,
                            "dataset_rows": int(len(group)),
                            "dataset_metadata_jsonl": metadata_jsonl.as_posix(),
                            "quality_gate": str(train_cfg.get("quality_gate", "strict")),
                        },
                    }
                ],
            },
        }
        file_name = f"cluster_{cluster_num:02d}.yaml"
        active_files.add(file_name)
        with (out_dir / file_name).open("w", encoding="utf-8") as f:
            yaml.safe_dump(per_cluster_cfg, f, sort_keys=False)

    for stale in out_dir.glob("cluster_*.yaml"):
        if stale.name not in active_files:
            stale.unlink(missing_ok=True)

    print(f"[TGIS] generated configs at {out_dir}")


if __name__ == "__main__":
    main()
