# DPPI ML Workspace

Camada de ML operacional do DPPI (Hetzner CX22 + Python + CatBoost).

Este diretorio implementa:
- build de datasets (`entry` e `survival`) via Supabase feature store/labels;
- treino temporal sem leakage;
- calibracao (`platt`/`isotonic`) com persistencia de metricas;
- inferencia batch para `dppi_predictions` e `dppi_survival_predictions`;
- materializacao de oportunidades;
- monitoramento de worker heartbeat e drift.
- utilitarios de pre-treino (backfill, audit de labels, baseline e familias de paineis).

## Pre-requisitos

1. Python 3.11+
2. Instalar dependencias:
```bash
pip install -r ml/dppi/requirements.txt
```
3. Variaveis de ambiente minimas:
- `SUPABASE_DB_URL` (ou `DATABASE_URL`) para SQL
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (heartbeat e edges)

## Estrutura principal

- `runtime.py`: config/env/db helpers
- `mlops.py`: split temporal, metricas, calibracao, persistencia de artefatos e SQL helpers
- `build_dataset_entry.py`
- `build_dataset_survival.py`
- `train_entry_model.py`
- `train_survival_model.py`
- `evaluate_and_calibrate.py`
- `publish_model.py` (com gates de qualidade)
- `batch_inference.py`
- `monitoring/worker_heartbeat.py`
- `monitoring/compute_drift.py`
- `monitoring/run_drift_for_release.py`
- `pipelines/run_worker_once.py`
- `pipelines/worker_tick.py`
- `features/backfill.py`
- `panel_families/assigner.py`
- `labels/audit.py`
- `labels/baseline_metrics.py`
- `configs/base.yaml`

## Fluxo recomendado

### 1) Build datasets

```bash
python ml/dppi/build_dataset_entry.py --config ml/dppi/configs/base.yaml
python ml/dppi/build_dataset_survival.py --config ml/dppi/configs/base.yaml
```

### 1.1) Backfill historico (antes do treino)

```bash
python ml/dppi/features/backfill.py \
  --config ml/dppi/configs/base.yaml \
  --region NAE \
  --surface-name CreativeDiscoverySurface_Frontend \
  --since 2026-01-01T00:00:00Z
```

Opcoes uteis:
- `--until <ISO>`
- `--target-id <uuid>`
- `--panel-name <panel>`
- `--skip-daily`
- `--skip-labels`

### 1.2) Atribuicao de familias de paineis (DPPI panel families)

```bash
python ml/dppi/panel_families/assigner.py \
  --region NAE \
  --surface-name CreativeDiscoverySurface_Frontend \
  --window-days 14 \
  --clusters 4 \
  --method kmeans
```

Dry-run:
```bash
python ml/dppi/panel_families/assigner.py --dry-run
```

### 1.3) Auditoria de labels (cobertura e balanceamento)

```bash
python ml/dppi/labels/audit.py \
  --config ml/dppi/configs/base.yaml \
  --region NAE \
  --surface-name CreativeDiscoverySurface_Frontend \
  --lookback-days 30 \
  --fail-on-issues
```

### 1.4) Baseline explicito pre-modelo

Entry:
```bash
python ml/dppi/labels/baseline_metrics.py \
  --config ml/dppi/configs/base.yaml \
  --task-type entry \
  --write-registry \
  --model-name dppi_baseline \
  --model-version v0
```

Survival:
```bash
python ml/dppi/labels/baseline_metrics.py \
  --config ml/dppi/configs/base.yaml \
  --task-type survival \
  --write-registry \
  --model-name dppi_baseline \
  --model-version v0
```

### 2) Treino (gate de readiness ativo)

```bash
python ml/dppi/train_entry_model.py --config ml/dppi/configs/base.yaml --model-version v20260227
python ml/dppi/train_survival_model.py --config ml/dppi/configs/base.yaml --model-version v20260227
```

### 3) Calibracao

```bash
python ml/dppi/evaluate_and_calibrate.py \
  --config ml/dppi/configs/base.yaml \
  --task-type entry \
  --model-name dppi_entry \
  --model-version v20260227

python ml/dppi/evaluate_and_calibrate.py \
  --config ml/dppi/configs/base.yaml \
  --task-type survival \
  --model-name dppi_survival \
  --model-version v20260227
```

### 4) Publicacao (com gate)

```bash
python ml/dppi/publish_model.py \
  --config ml/dppi/configs/base.yaml \
  --channel candidate \
  --model-name dppi_entry \
  --model-version v20260227
```

### 5) Inference batch

```bash
python ml/dppi/batch_inference.py --config ml/dppi/configs/base.yaml --channel production
```

Obs: no periodo pre-treino, o sistema pode operar em modo heuristico no backend
(`seed_dppi_heuristic_predictions`) para manter `dppi_predictions` aquecido.

### 6) Drift

```bash
python ml/dppi/monitoring/run_drift_for_release.py --config ml/dppi/configs/base.yaml
```

### 7) Tick unico do worker (producao)

```bash
python ml/dppi/pipelines/worker_tick.py --config ml/dppi/configs/base.yaml --channel production
```

## Operacao em Hetzner CX22

Use o runbook:
- `docs/DPPI_HETZNER_CX22_RUNBOOK.md`

E os arquivos de deploy:
- `ml/dppi/deploy/systemd/dppi-worker.service`
- `ml/dppi/deploy/systemd/dppi-worker.timer`
- `ml/dppi/deploy/install_systemd.sh`

## Regras importantes

1. Treino antes da janela minima e bloqueado automaticamente (`dppi_training_readiness`).
2. Alternancia de release deve seguir gates de qualidade/calibracao/drift.
3. `worker_tick` nao deve ser executado com credenciais limitadas (precisa service role).
4. Artefatos ficam em `ml/dppi/artifacts/` (nao versionar no git).
5. Antes do primeiro treino real: rodar `backfill`, `assigner`, `audit` e `baseline_metrics`.
