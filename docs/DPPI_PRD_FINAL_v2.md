# Surprise Radar — Discover Promotion Predictive Intelligence (DPPI)
**PRD Final v2.0 — Documento Completo de Implementação**  
Data: 2026-02-26  
Owner: Surprise Radar (Giih)  
Status: Aprovado para implementação

---

## 0. Executive Summary

O Surprise Radar já captura exposição do Discover Fortnite 24/7 e replica painéis em near real-time. O DPPI é a camada preditiva que transforma esses dados em inteligência acionável: **quando e por que uma ilha vai entrar num painel, e o que ela precisa fazer para se manter**.

O sistema substitui completamente o "Ver Timeline" atual (que usa cálculos estáticos sem aprendizado) por um motor que:
- Aprende continuamente com os dados observados
- Produz probabilidades calibradas de entrada e sobrevivência
- Explica os fatores que determinam o resultado
- É narrado e auditado pelo Ralph (Kimi K2.5)

**Stack de implementação:** Supabase Cloud Pro + Hetzner CX22 (Python worker) + CatBoost + Ralph/Kimi K2.5  
**Equipe:** Solo developer + Claude Code + Codex + Ralph  
**Fase atual:** Acumulação de dados (60–90 dias antes do primeiro treino)

---

## 1. Contexto e Problema

### 1.1 O que existe hoje

O "Ver Timeline" atual exibe inteligência de painel calculada via SQL estático:
- CCU médio, entradas/saídas 24h, trocas de slot
- Faixas de CCU e exposição baseadas em percentis simples (P40/P80)
- Sinal de permanência (keep-alive CCU + minutos mínimos)
- Fluxo entre painéis (top próximos / top origem)
- Tentativas por ilha, reentrada/abandono 48h

**O problema:** Tudo isso descreve o comportamento histórico médio do painel. Não diz nada sobre uma ilha específica. O criador não consegue responder:

> "A minha ilha tem chance de entrar no Popular? Por quê não está entrando? O que eu preciso mudar?"

### 1.2 O que o DPPI resolve

O DPPI adiciona duas camadas que hoje não existem:

**Camada 1 — Predição por ilha:**  
Para uma ilha específica, em um painel específico, na próxima janela de tempo (2h, 5h, 12h): qual a probabilidade de entrada? Se entrar, vai sobreviver?

**Camada 2 — Explicação acionável:**  
Quais fatores estão impedindo a entrada? O que separa essa ilha das que já estão no painel? O que mudou nas últimas horas que aumentou/diminuiu a chance?

### 1.3 Por que o Discovery do Fortnite exige horizontes curtos

O Discovery rotaciona muito rápido. Com 100–200 entradas por dia em 20 painéis, a janela de relevância é de **2–5 horas**, não de 12–24 horas. O DPPI usa horizontes curtos como primários e longos como secundários.

---

## 2. Objetivos

### 2.1 Objetivos primários

1. **Predizer entrada no painel**  
   Para cada `(ilha, painel, surface, região, tempo t)`:  
   - `P(entrada válida em t+2h)` — horizonte primário  
   - `P(entrada válida em t+5h)` — horizonte primário  
   - `P(entrada válida em t+12h)` — horizonte secundário

2. **Predizer sobrevivência**  
   Condicional a estar no painel em t:  
   - `P(sobrevive >= 30 min)`  
   - `P(sobrevive >= 60 min)`  
   - `P(substituída antes de 30 min)`

3. **Explicar em linguagem acionável**  
   Para cada predição, produzir:  
   - Top 3–5 fatores que mais influenciam o resultado
   - Comparação com ilhas que estão no painel agora
   - O que a ilha precisa melhorar (gap de CCU, tempo de exposição, etc.)

4. **Substituir o Ver Timeline**  
   O DPPI não é uma feature adicional. Substitui completamente os cálculos estáticos atuais por um sistema que aprende continuamente e usa o Ralph para narrativa.

5. **Operar via Ralph**  
   Ralph (Kimi K2.5) consome os outputs do modelo e gera:  
   - Narrativas de insight por ilha e por painel
   - Detecção de regressão e drift
   - Memória acumulada de padrões e decisões

### 2.2 Non-goals

- Não reverter o algoritmo exato da Epic
- Não afirmar causalidade (apenas correlação observada)
- Não fazer deploy autônomo em produção
- Não usar dados de usuário (PII) ou fontes externas não coletadas
- Não prometer precisão absoluta — sempre comunicar incerteza ao usuário

---

## 3. Dados e Sinais

### 3.1 Tabelas existentes utilizadas

| Tabela | Uso no DPPI |
|--------|-------------|
| `discovery_exposure_presence_segments` | Base de stints — fonte principal de features e labels |
| `discovery_exposure_presence_events` | Eventos enter/exit — base de labels de entrada |
| `discovery_exposure_rank_segments` | Rank e slot — features de pressão e replacement |
| `discovery_exposure_rollup_daily` | Rollup diário — features de tendência de longo prazo |
| `discovery_panel_intel_snapshot` | Regime operacional do painel — features G3 |
| `discover_link_metadata` | Metadados da ilha — features estáticas |
| `discover_link_metadata_events` | Mudanças de thumb/title/map — features G5 |
| `discovery_exposure_targets` | Mapeamento target/região/surface |

### 3.2 Entidades core

- `island_id` / `link_code` — identificador da ilha
- `panel_name` — nome técnico do painel (ex: `Nested_Popular`)
- `panel_family` — família operacional do painel (calculada semanalmente)
- `surface_name` — surface de discovery
- `region` — região (NAE, EU, BR, ASIA)
- `target_id` — target de exposição
- `t` — ponto no tempo de geração da feature

### 3.3 Volume atual de dados (2026-02-26)

| Tabela | Linhas | Tamanho |
|--------|--------|---------|
| `discovery_exposure_rank_segments` | 3.597.288 | 2026 MB |
| `discovery_exposure_presence_events` | 811.977 | 327 MB |
| `discovery_exposure_presence_segments` | 412.736 | 218 MB |
| `discover_link_metadata_events` | 945.620 | 256 MB |

**Nota crítica de dados:** A coleta contínua confiável começou ~2 semanas atrás. O primeiro treino sério deve ocorrer somente após acumular 60–90 dias de dados (ver Seção 15 — Fases de Implementação). O período até lá é usado para construir toda a infraestrutura.

---

## 4. Tarefas de Aprendizado Formais

### 4.1 Task A — Predição de Entrada no Painel (Primária)

Para cada candidato `(ilha, painel, t)`:

> `y_entry = 1` se existe um evento de entrada válida no painel alvo em `(t, t+H]`

**Entrada válida** (evita treinar em flash exposures):
- `enter_event` deve existir, E
- stint resultante >= `MIN_ENTRY_STINT_MINUTES = 3 min`, OU
- `ticks_in_panel >= MIN_ENTRY_TICKS = 2`

**Horizontes H:**
- H = 2h (primário — Discovery rotaciona rápido)
- H = 5h (primário)
- H = 12h (secundário)

Modelos separados por horizonte (mais simples de calibrar).

### 4.2 Task B — Predição de Sobrevivência (Secundária)

Para cada entrada válida em `t_enter`:

> `y_survive = 1` se stint >= T minutos  
> `y_replaced = 1` se closed_reason = 'replaced' antes de T

**Limiares T:** 30 min, 60 min

---

## 5. Algoritmo Escolhido

### 5.1 CatBoost Gradient Boosted Decision Trees

**Por que CatBoost especificamente:**

1. **Features categoriais de alta cardinalidade** — painel, região, surface, categoria/tag, creator são categóricos; CatBoost trata nativamente sem one-hot encoding manual
2. **Interações não-lineares** — Discovery tem efeitos de threshold; GBDT captura sem feature crosses manuais
3. **Performance em dados tabulares** — supera redes neurais em dados tabulares event-driven
4. **Explicabilidade por linha** — importância de feature por instância via SHAP integrado
5. **Treino rápido em CPU** — roda no Hetzner CX22 sem GPU

**O que deliberadamente não usamos:**
- Transformers/LSTMs: custo maior, difícil de auditar, desnecessário com features bem engenheiradas
- Heurísticas puras: não generalizam entre painéis/regiões, não suportam regressão sistemática

### 5.2 Estratégia: Panel-Family Models

Painéis agrupados por regime operacional em `panel_family` usando clustering simples (k-means ou quintis) em:
- `replacements_24h`
- `entries_24h`
- `avg_stint_minutes`
- `keep_alive_minutes_min`

Um modelo CatBoost por `(panel_family, surface, horizon)` com região como feature.  
Reatribuição de famílias semanal, versionada no model registry.  
Resultado esperado: 3–5 famílias × 3 horizontes = ~9–15 modelos Task A.

---

## 6. Sistema de Features

Todas as features são funções determinísticas de dados `<= t`. Sem leakage.

### G1 — Momentum da ilha (janelas deslizantes W ∈ {15m, 1h, 6h, 24h})

| Feature | Descrição |
|---------|-----------|
| `presence_ratio_W` | % de ticks onde ilha está visível em qualquer painel |
| `panel_presence_ratio_W` | % de ticks onde ilha está em painéis da mesma família |
| `stints_count_W` | número de stints iniciados na janela |
| `closed_stints_count_W` | número de stints encerrados na janela |
| `time_since_last_seen` | minutos desde última visibilidade |
| `time_since_last_seen_target_panel` | minutos desde último stint no painel alvo |
| `attempts_48h` | tentativas de entrar no painel alvo nas últimas 48h |
| `reentry_48h_flag` | ilha reentrou no painel alvo nas últimas 48h |
| `abandon_48h_flag` | ilha abandonou o painel alvo nas últimas 48h |

### G2 — Pressão de rank/slot

| Feature | Descrição |
|---------|-----------|
| `rank_slope_1h` | slope linear da posição de rank na última hora |
| `rank_volatility_6h` | desvio padrão das mudanças de rank |
| `was_replaced_recently` | indicador de replacement em rank segments recentes |

### G3 — Regime operacional do painel (do `discovery_panel_intel_snapshot`)

| Feature | Descrição |
|---------|-----------|
| `entries_24h` | entradas nas últimas 24h |
| `exits_24h` | saídas nas últimas 24h |
| `replacements_24h` | trocas de slot nas últimas 24h |
| `panel_avg_ccu` | CCU médio do painel |
| `avg_exposure_minutes_per_stint` | exposição média por stint |
| `keep_alive_ccu_min` | CCU mínimo de permanência |
| `keep_alive_minutes_min` | minutos mínimos de permanência |
| `ccu_band_p40` | limiar de banda "Bom" de CCU |
| `ccu_band_p80` | limiar de banda "Excelente" de CCU |
| `attempts_avg_per_island` | tentativas médias por ilha nesse painel |
| `reentry_48h_pct` | % de reentrada 48h do painel |
| `abandon_48h_pct` | % de abandono 48h do painel |

### G4 — Topologia de transição

| Feature | Descrição |
|---------|-----------|
| `prev_panel_match_score` | ilha aparece em painel feeder conhecido nas últimas 24h |
| `gap_from_prev_panel_p50` | gap observado vs mediana do painel de origem |
| `transition_in_share` | share do painel de origem nos top_prev_panels do alvo |

### G5 — Sinais de metadata

| Feature | Descrição |
|---------|-----------|
| `thumb_changed_7d` | thumbnail alterado nos últimos 7 dias |
| `title_changed_7d` | título alterado nos últimos 7 dias |
| `map_updated_7d` | mapa atualizado nos últimos 7 dias |
| `days_since_last_update` | dias desde qualquer atualização |

### G6 — Features de entry context (Task B apenas)

| Feature | Descrição |
|---------|-----------|
| `entry_rank` | rank/slot de entrada |
| `entry_time_of_day` | hora do dia da entrada |
| `panel_state_at_entry` | `active_maps_now` no momento da entrada |
| `rank_slope_10min_post_entry` | slope de rank nos primeiros 10 min pós-entrada |

### 6.3 Candidate Generation

Uma ilha é candidata para um painel em t se **qualquer** condição for verdadeira:

1. **Recently observed:** Visível na mesma `(região, surface)` nas últimas `LOOKBACK = 72h`
2. **Momentum gate:** `presence_ratio_6h >= 0.10` OU `stints_count_24h >= 2`
3. **Feeder proximity:** Apareceu em painel feeder do alvo nas últimas 24h

Candidatura auditada: escreve `(painel, região, surface, t, count, flags)` em tabela de auditoria.

---

## 7. Construção de Labels

### 7.1 Task A

```
y_entry = 1 se ∃ valid_entry no painel alvo em (t, t+H]
y_entry = 0 caso contrário
flash_entry = 1 se entrada ocorreu mas stint < MIN_ENTRY_STINT_MINUTES (só diagnóstico)
```

### 7.2 Task B

```
y_survive_30 = 1 se stint_minutes >= 30
y_survive_60 = 1 se stint_minutes >= 60
y_replaced_30 = 1 se closed_reason = 'replaced' E stint_minutes < 30
```

### 7.3 Split temporal (obrigatório — sem random split)

```
Train:    [D0, Dk)           mínimo 60 dias
Validate: [Dk, Dk + 14d)
Test:     [Dk + 14d, Dk + 21d)
```

Primeiro treino requer mínimo 81 dias de dados acumulados.

---

## 8. Protocolo de Treino e Avaliação

### 8.1 Métricas obrigatórias

| Métrica | Descrição |
|---------|-----------|
| **PR-AUC** | Métrica primária — robusta a eventos raros |
| **Precision@K** (K=20, K=50) | Operacional — top K por painel/região |
| **Brier score** | Calibração global |
| **Reliability buckets** | Calibração por faixa de probabilidade |
| **PSI por grupo de feature** | Drift de distribuição |

### 8.2 Calibração de probabilidades (obrigatório)

- **Isotonic regression** quando >= 500 exemplos positivos por slice
- **Platt scaling** para slices com baixo volume
- Calibração por `(region, panel_family)` no mínimo

### 8.3 Model registry artifacts

Cada modelo armazena: version_id, panel_family, horizon, training_window, feature_schema_hash, metrics, calibration params, top importances, drift baseline, benchmark de treino.

### 8.4 Gates de promoção de modelo

| Gate | Threshold |
|------|-----------|
| PR-AUC queda máxima | 5% vs baseline |
| Precision@20 queda máxima | 10% |
| Brier score piora máxima | 15% |
| PSI máximo por grupo | 0.25 |

---

## 9. Infraestrutura

### 9.1 Stack de produção

```
Supabase Cloud Pro (Small Compute)
├── Postgres + RLS + Auth + Edge Functions + pg_cron
├── Todas as tabelas existentes
└── Novas tabelas DPPI

Hetzner Cloud CX22 (~€4/mês)
├── 2 vCPU AMD, 4GB RAM, 40GB SSD
├── Ubuntu 24.04 LTS
├── Python 3.11 + CatBoost + scikit-learn + pandas
├── Cron interno para orchestration
└── Sem Docker inicialmente
```

**Por que Hetzner CX22:**
- Mais barato da categoria (€4/mês vs PC ligado 24h)
- CatBoost com 50k rows treina em < 10 min nessa CPU
- Upgrade para CX32 (€8/mês) quando necessário
- Migração sem reescrever código

**Self-hosted Supabase — NÃO agora.** Revisar quando custo de storage superar €30/mês.

### 9.2 Comunicação Python ↔ Supabase

Worker usa conexão direta ao Postgres via `psycopg2` (não REST API para operações em lote).

```python
import psycopg2
conn = psycopg2.connect(
    host="db.<project-ref>.supabase.co",
    port=5432,
    database="postgres",
    user="postgres",
    password=os.environ["SUPABASE_DB_PASSWORD"],
    sslmode="require"
)
```

### 9.3 Variáveis de ambiente no Hetzner

```bash
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_DB_PASSWORD=<db-password>
SUPABASE_DB_HOST=db.<ref>.supabase.co
NVIDIA_API_KEY=<nvidia-key>
```

---

## 10. Python Worker — Estrutura de Arquivos

```
/opt/dppi/
├── .env
├── requirements.txt
├── dppi/
│   ├── config.py                 # Constantes, env vars
│   ├── db.py                     # Conexão Postgres, helpers
│   ├── features/
│   │   ├── builder.py            # Orquestra construção de features
│   │   ├── momentum.py           # G1
│   │   ├── rank_pressure.py      # G2
│   │   ├── panel_regime.py       # G3
│   │   ├── transitions.py        # G4
│   │   └── metadata.py           # G5
│   ├── labels/
│   │   ├── candidates.py         # Candidate generation
│   │   ├── entry.py              # Labels Task A
│   │   └── survival.py           # Labels Task B
│   ├── training/
│   │   ├── trainer.py            # CatBoost training
│   │   ├── calibration.py        # Isotonic / Platt
│   │   ├── evaluation.py         # PR-AUC, Precision@K, Brier
│   │   └── registry.py           # Model registry
│   ├── inference/
│   │   ├── scorer.py             # Scoring com modelo atual
│   │   ├── evidence.py           # Evidence block (SHAP)
│   │   └── writer.py             # Escreve no Supabase
│   ├── drift/
│   │   └── monitor.py            # PSI + alertas
│   ├── panel_families/
│   │   └── assigner.py           # Clustering por regime
│   └── orchestrator.py           # Entry point principal
└── scripts/
    ├── setup_hetzner.sh           # Setup inicial (run once)
    ├── run_training.sh
    ├── run_inference.sh
    └── health_check.sh
```

### 10.1 requirements.txt

```
catboost==1.2.5
scikit-learn==1.4.2
pandas==2.2.2
numpy==1.26.4
psycopg2-binary==2.9.9
python-dotenv==1.0.1
joblib==1.4.2
shap==0.45.0
supabase==2.4.6
schedule==1.2.2
```

### 10.2 Fluxo do Orchestrator

**run_training_cycle() — diariamente às 03:00:**
1. Verificar se há >= MIN_TRAINING_DAYS de dados
2. Para cada panel_family:
   - Computar panel_family assignments
   - Para cada horizonte H: build dataset → split temporal → treinar CatBoost → calibrar → avaliar → verificar gates → promover ou rejeitar
3. Salvar benchmark em `dppi_training_log`
4. Escrever resultado em `ralph_actions`

**run_inference_cycle() — a cada 30 minutos:**
1. Carregar modelos current do registry
2. Gerar candidate set atual
3. Construir features para todos candidatos
4. Pontuar com cada modelo
5. Calibrar outputs
6. Gerar evidence blocks (SHAP)
7. Escrever em `dppi_predictions` e `dppi_opportunities`
8. Verificar drift — alertar se PSI > threshold

### 10.3 Crontab no Hetzner

```bash
# Inference a cada 30 minutos
*/30 * * * * /opt/dppi/scripts/run_inference.sh >> /opt/dppi/logs/inference.log 2>&1

# Treino diário às 03:00
0 3 * * * /opt/dppi/scripts/run_training.sh >> /opt/dppi/logs/training.log 2>&1
```

---

## 11. Novas Tabelas Supabase (Migrations)

### dppi_predictions
```sql
CREATE TABLE dppi_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  island_id TEXT NOT NULL,
  panel_name TEXT NOT NULL,
  panel_family TEXT NOT NULL,
  surface_name TEXT NOT NULL,
  region TEXT NOT NULL,
  horizon_hours INT NOT NULL,
  p_enter FLOAT NOT NULL,
  p_enter_raw FLOAT,
  model_version_id TEXT NOT NULL,
  evidence_json JSONB,
  scored_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_dppi_pred_island ON dppi_predictions(island_id, scored_at DESC);
CREATE INDEX idx_dppi_pred_panel ON dppi_predictions(panel_name, region, scored_at DESC);
```

### dppi_opportunities
```sql
CREATE TABLE dppi_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  panel_name TEXT NOT NULL,
  panel_family TEXT NOT NULL,
  surface_name TEXT NOT NULL,
  region TEXT NOT NULL,
  horizon_hours INT NOT NULL,
  rank INT NOT NULL,
  island_id TEXT NOT NULL,
  p_enter FLOAT NOT NULL,
  evidence_json JSONB
);
CREATE INDEX idx_dppi_opps_panel ON dppi_opportunities(panel_name, region, horizon_hours, refreshed_at DESC);
```

### dppi_survival_predictions
```sql
CREATE TABLE dppi_survival_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  island_id TEXT NOT NULL,
  panel_name TEXT NOT NULL,
  region TEXT NOT NULL,
  p_survive_30 FLOAT,
  p_survive_60 FLOAT,
  p_replaced_30 FLOAT,
  model_version_id TEXT NOT NULL,
  evidence_json JSONB,
  scored_at TIMESTAMPTZ NOT NULL
);
```

### dppi_model_registry
```sql
CREATE TABLE dppi_model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version_id TEXT NOT NULL UNIQUE,
  panel_family TEXT NOT NULL,
  surface_name TEXT NOT NULL,
  horizon_hours INT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  training_window_start DATE NOT NULL,
  training_window_end DATE NOT NULL,
  feature_schema_hash TEXT NOT NULL,
  metrics_json JSONB NOT NULL,
  calibration_json JSONB,
  top_importances_json JSONB,
  drift_baseline_json JSONB,
  benchmark_json JSONB,
  model_file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ
);
```

### dppi_panel_families
```sql
CREATE TABLE dppi_panel_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_name TEXT NOT NULL,
  surface_name TEXT NOT NULL,
  region TEXT NOT NULL,
  panel_family TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_days INT NOT NULL,
  regime_metrics_json JSONB
);
```

### dppi_training_log
```sql
CREATE TABLE dppi_training_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  panel_family TEXT,
  horizon_hours INT,
  models_trained INT DEFAULT 0,
  models_promoted INT DEFAULT 0,
  models_rejected INT DEFAULT 0,
  error_message TEXT,
  summary_json JSONB
);
```

### Retenção de dados

| Tabela | Retenção |
|--------|----------|
| `dppi_predictions` | 7 dias |
| `dppi_opportunities` | 24 horas |
| `dppi_survival_predictions` | 7 dias |
| `dppi_model_registry` | Indefinido |
| `dppi_training_log` | 90 dias |

---

## 12. Contrato de Output — Evidence Block

```json
{
  "island_id": "4826-5238-3419",
  "panel_name": "Nested_Popular",
  "panel_family": "high_volatility",
  "region": "BR",
  "surface": "CreativeDiscoverySurface_Frontend",
  "horizon_hours": 2,
  "p_enter": 0.74,
  "evidence": {
    "top_features": [
      {
        "name": "presence_ratio_6h",
        "display": "Presença recente (6h)",
        "value": 0.83,
        "direction": "+",
        "impact": 0.12,
        "context": "Ilha visível em 83% dos ticks nas últimas 6h"
      },
      {
        "name": "panel_entries_24h",
        "display": "Rotação do painel",
        "value": 43,
        "direction": "+",
        "impact": 0.08,
        "context": "Painel com alta rotação hoje (43 entradas)"
      },
      {
        "name": "keep_alive_minutes_min",
        "display": "Exigência de permanência",
        "value": 55,
        "direction": "-",
        "impact": -0.05,
        "context": "Painel exige >= 55 min de exposição para manter"
      }
    ],
    "panel_baseline": {
      "entries_24h": 43,
      "replacements_24h": 263,
      "keep_alive_ccu_min": 1200,
      "keep_alive_minutes_min": 55
    },
    "gap_analysis": {
      "island_ccu_last_1h": 890,
      "panel_keep_alive_ccu": 1200,
      "gap_ccu": -310,
      "island_avg_stint_min": 42,
      "panel_keep_alive_min": 55,
      "gap_minutes": -13
    }
  }
}
```

---

## 13. UX — Duas Superfícies de Produto

### 13.1 Superfície 1 — Substituição do "Ver Timeline"

O modal "Ver Timeline" é **completamente substituído**. Cálculos estáticos atuais mantidos apenas como fallback enquanto DPPI não tem modelos prontos.

**Seção A — Inteligência do painel (mantida e melhorada via DPPI)**
- CCU médio, exposição média, entradas/saídas 24h, trocas de slot
- Faixas de CCU e exposição (agora mais precisas com aprendizado)
- Sinal de permanência, fluxo entre painéis, tentativas/reentrada

**Seção B — NOVO: Top oportunidades agora**
- "Top 10 ilhas com maior probabilidade de entrar nesse painel nas próximas 2h"
- Cada item: nome da ilha, `p_enter`, top 2 fatores
- Atualizado a cada 30 minutos

**Seção C — NOVO: Sinal de abertura do painel**
- "Painel aberto para novas entradas" / "Painel em saturação"
- Derivado de `entries_24h` vs baseline + `active_maps_now` vs capacidade típica
- Indicador visual simples (verde/amarelo/vermelho)

### 13.2 Superfície 2 — Seção DPPI na página /island?

Nova seção dedicada em cada página de ilha.

**Card: Radar de Promoção**
```
Para entrar em Popular (BR):
████████░░  74%  nas próximas 2h
██████████  82%  nas próximas 5h

Para entrar em Top Rated (BR):
████░░░░░░  41%  nas próximas 2h
```

**Card: Por que está assim**
```
✅ Alta presença recente (83% de visibilidade em 6h)
✅ Popular com alta rotação hoje (43 entradas)
⚠️  CCU 310 abaixo do mínimo de permanência
⚠️  Última atualização há 14 dias

O que pode melhorar:
→ Aumentar CCU para >= 1.200 (faltam ~310)
→ Ilhas atualizadas recentemente entram 23% mais
```

**Card: Sobrevivência (se a ilha está no painel agora)**
```
Ilha está em Popular agora

Probabilidade de sobreviver 30 min: 67%
Probabilidade de ser substituída antes: 33%
```

**Card: Histórico de painéis**
- Timeline de quais painéis a ilha entrou
- Duração média por painel
- Padrões de entrada (dia, hora)

### 13.3 Nomenclatura para o usuário

| Interno | Para o usuário |
|---------|---------------|
| `p_enter` | "Probabilidade de entrar" |
| `panel_family: high_volatility` | "Painel com alta rotação" |
| `presence_ratio_6h` | "Presença recente" |
| `keep_alive_ccu_min` | "CCU mínimo para se manter" |
| `replacements_24h` | "Trocas de slot hoje" |

---

## 14. Ralph Integration (Kimi K2.5)

### 14.1 Papel do Ralph

Ralph **não é o preditor**. É o **operador auditado + analista**:
- Converte predições numéricas em narrativas acionáveis
- Detecta regressão e drift no modelo
- Propõe ajustes de features ou pipeline (modo `dataops`)
- Mantém memória durable de padrões, decisões e anomalias

### 14.2 Modos de run

| Modo | Propósito |
|------|-----------|
| `dataops` | Ajustar features SQL, tuning, retenção, indexação |
| `report` | Gerar evidence packs e narrativas para UI |
| `qa` | Detectar regressão em métricas, drift, calibração |

### 14.3 Context pack DPPI para Ralph

```json
{
  "dppi_summary": {
    "models_current": [...],
    "latest_training_log": {...},
    "drift_alerts": [...],
    "top_opportunities_sample": [...],
    "precision_at_20_trend": [...],
    "pr_auc_trend": [...]
  }
}
```

### 14.4 Política de escrita de memória

Um `memory_item` do DPPI deve incluir:
- `memory_key` estável (ex: `dppi.panel.popular_br.keep_alive_shift`)
- `claim` em uma frase
- `evidence_refs` (model_version_id + run_id)
- `impact_metrics` (quais métricas mudaram)
- `validity`: `ttl_hours: 168` para fatos de regime de painel

---

## 15. Fases de Implementação

### Fase 0 — Infraestrutura e Acumulação de Dados (Agora → Dia 60)

**Objetivo:** Construir infraestrutura completa. Nenhum modelo treinado ainda.

- [ ] Criar VPS Hetzner CX22, configurar SSH
- [ ] Instalar Python 3.11 + venv + requirements.txt
- [ ] Criar estrutura `/opt/dppi/` com todos os módulos
- [ ] Implementar `config.py` e `db.py`
- [ ] Criar migrations Supabase para todas as tabelas DPPI
- [ ] Implementar `panel_families/assigner.py`
- [ ] Implementar `labels/candidates.py`
- [ ] Implementar `labels/entry.py`
- [ ] Implementar `features/builder.py` (G1–G5)
- [ ] **Label audit:** contar labels por `(panel_family, region, horizon)` — documentar
- [ ] **Baseline burra:** calcular hit rate de "ilha que esteve no painel nas últimas 6h"
- [ ] Configurar cron de inference (valida pipeline mesmo sem modelo)

**Critério de saída:** Features buildando sem erro, 60+ dias de dados, >= 500 positivos por panel_family documentados.

### Fase 1 — Primeiro Treino e Validação (Dia 60 → Dia 90)

**Objetivo:** Treinar primeiros modelos. Validar que batem a baseline burra.

- [ ] Implementar `training/trainer.py` com CatBoost
- [ ] Implementar `training/calibration.py`
- [ ] Implementar `training/evaluation.py`
- [ ] Implementar `training/registry.py`
- [ ] Primeiro treino: Task A, horizontes 2h e 5h, todas panel_families
- [ ] PR-AUC > baseline burra confirmado
- [ ] Implementar `inference/scorer.py` + `inference/writer.py`
- [ ] Inference escrevendo em `dppi_predictions` a cada 30 min

**Critério de saída:** Modelo batendo baseline, predictions no Supabase, calibração razoável.

### Fase 2 — UI e Ralph Integration (Dia 90 → Dia 120)

**Objetivo:** Predições visíveis na UI. Ralph ativo para insights.

- [ ] Edge Function `dppi-island-predictions`
- [ ] Edge Function `dppi-panel-opportunities`
- [ ] Substituir "Ver Timeline" com Seções B e C
- [ ] Criar seção DPPI em `/island?`
- [ ] Ralph modo `report` ativo
- [ ] Ralph modo `qa` ativo
- [ ] Docs DPPI ingeridos na memória semântica
- [ ] **Release interno** (equipe + conhecidos)

### Fase 3 — Sobrevivência, Drift e Maturidade (Dia 120+)

- [ ] Task B (survival prediction)
- [ ] `drift/monitor.py` com PSI + alertas automáticos
- [ ] Card de sobrevivência na página da ilha
- [ ] Gap analysis acionável ("faltam X de CCU")
- [ ] Reajuste de panel_family assignments com 3+ meses
- [ ] Tuning de hiperparâmetros
- [ ] Abertura gradual para comunidade

---

## 16. Garantias Operacionais

### 16.1 Fallback

Se DPPI não tem modelos ou último modelo foi rejeitado pelos gates:
- "Ver Timeline" mostra cálculos estáticos atuais
- Página da ilha não exibe seção DPPI (hidden, não erro)
- Ralph levanta alerta em `system_alerts_current`

### 16.2 Comunicação de incerteza para o usuário

O UI deve sempre exibir:
- Data/hora da última atualização das predições
- Indicador de confiança baseado em volume de treino
- Disclaimer: "Baseado em padrões observados. Não garante entrada no painel."

### 16.3 Detecção de mudança de algoritmo da Epic

Sinal de alerta:
- PR-AUC cai > 10% em 3 treinos consecutivos
- PSI > 0.4 em múltiplos grupos de features
- Precision@20 próximo de random (< 0.15)

Ação:
- `ralph_incident` tipo `model_drift_severe`
- Modelo anterior mantido como current
- Aviso na UI: "Modelo em revisão — predições podem ter precisão reduzida"

### 16.4 RLS

- `dppi_predictions`: leitura pública
- `dppi_opportunities`: leitura pública
- `dppi_model_registry`: apenas admin/service_role
- `dppi_training_log`: apenas admin/service_role
- Escritas apenas via service_role (worker Python)

---

## 17. Glossário

| Termo | Definição |
|-------|-----------|
| **Panel family** | Grupo de painéis com regime operacional similar |
| **Stint** | Permanência contínua de uma ilha em um painel |
| **Valid entry** | Entrada com stint >= 3 minutos |
| **Flash entry** | Entrada com stint < 3 min (filtrada dos labels) |
| **p_enter** | Probabilidade calibrada de entrada no horizonte H |
| **PR-AUC** | Area Under Precision-Recall Curve — métrica primária |
| **PSI** | Population Stability Index — métrica de drift |
| **Keep-alive** | CCU + minutos mínimos para se manter no painel |
| **Candidate set** | Conjunto de (ilha, painel) elegíveis para scoring |
| **Evidence block** | JSON com top features e valores para cada predição |
| **Ralph** | Operador de automação auditado (Kimi K2.5 via NVIDIA) |
| **Gap analysis** | Diferença entre métricas atuais da ilha e limiar do painel |

---

*Fim do documento. PRD Final v2.0 — 2026-02-26*
