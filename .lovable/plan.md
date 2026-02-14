

# Reestruturacao Completa do Pipeline Discover Trends

## Resumo

Reescrever toda a arquitetura de coleta de dados do Discover Trends, substituindo o modelo atual (JSON monolitico em `raw_metrics`, dupla paginacao, delays fixos) por um pipeline de 3 fases persistentes no banco com filas, tabelas por-ilha, e concorrencia adaptativa.

---

## Fase 1: Migracoes SQL (3 novas tabelas/colunas)

### 1.1 Alterar `discover_reports`

Adicionar colunas para controle de fase e progresso:

- `phase` TEXT DEFAULT 'catalog' -- catalog | metrics | finalize | ai | done
- `catalog_discovered_count` INT DEFAULT 0
- `catalog_done` BOOLEAN DEFAULT false
- `catalog_cursor` TEXT NULL
- `queue_total` INT NULL
- `metrics_done_count` INT DEFAULT 0
- `reported_count` INT DEFAULT 0
- `suppressed_count` INT DEFAULT 0
- `error_count` INT DEFAULT 0
- `estimated_total` INT NULL
- `progress_pct` INT DEFAULT 0
- `started_at` TIMESTAMPTZ DEFAULT now()

A coluna `raw_metrics` continua existindo mas nao sera mais usada pelo novo pipeline (pode ser removida futuramente).

### 1.2 Criar `discover_report_queue`

Tabela de fila para persistir os island codes de cada report:

- `id` UUID PK DEFAULT gen_random_uuid()
- `report_id` UUID NOT NULL (FK -> discover_reports)
- `island_code` TEXT NOT NULL
- `status` TEXT DEFAULT 'pending' -- pending | processing | done | error
- `locked_at` TIMESTAMPTZ NULL
- `attempts` INT DEFAULT 0
- `last_error` TEXT NULL
- `created_at` TIMESTAMPTZ DEFAULT now()
- `updated_at` TIMESTAMPTZ DEFAULT now()
- UNIQUE (report_id, island_code)
- INDEX (report_id, status)

RLS: service_role para INSERT/UPDATE/DELETE, authenticated para SELECT.

### 1.3 Criar `discover_report_islands`

Tabela "1 ilha = 1 row" que substitui o `raw_metrics` JSON gigante:

- `id` UUID PK DEFAULT gen_random_uuid()
- `report_id` UUID NOT NULL (FK -> discover_reports)
- `island_code` TEXT NOT NULL
- `title` TEXT
- `creator_code` TEXT
- `category` TEXT
- `created_in` TEXT
- `tags` JSONB DEFAULT '[]'
- `status` TEXT -- reported | suppressed | error
- `probe_unique` INT NULL
- `probe_plays` INT NULL
- `probe_minutes` INT NULL
- `probe_peak_ccu` INT NULL
- `probe_date` DATE NULL
- `week_unique` INT NULL
- `week_plays` INT NULL
- `week_minutes` INT NULL
- `week_minutes_per_player_avg` FLOAT NULL
- `week_peak_ccu_max` INT NULL
- `week_favorites` INT NULL
- `week_recommends` INT NULL
- `week_d1_avg` FLOAT NULL
- `week_d7_avg` FLOAT NULL
- `updated_at` TIMESTAMPTZ DEFAULT now()
- UNIQUE (report_id, island_code)
- Indices de ranking: (report_id, week_plays DESC), (report_id, week_unique DESC), etc.

RLS: service_role para INSERT/UPDATE, authenticated para SELECT.

---

## Fase 2: Reescrever `discover-collector/index.ts`

O edge function inteiro sera reescrito com 4 modos stateless, onde todo estado vive no banco.

### mode: "start"

1. Cria row em `discover_reports` com `phase='catalog'`
2. Busca `queue_total` do ultimo report completado para usar como `estimated_total`
3. Retorna `{ reportId, estimated_total }`

### mode: "catalog"

1. Le `catalog_cursor` de `discover_reports`
2. Pagina `/islands?size=1000` (usando cursor ou comecando do zero)
3. Insere island codes em lote na `discover_report_queue` (`INSERT ... ON CONFLICT DO NOTHING`)
4. Atualiza `catalog_discovered_count` e `catalog_cursor`
5. Se estimated_total existe, calcula `progress_pct = min(10, floor((discovered/estimated)*10))`
6. Se nextCursor == null: marca `catalog_done=true`, faz `COUNT(*)` na queue para setar `queue_total`, muda `phase='metrics'`, `progress_pct=10`
7. Retorna status e contadores

Sem delays fixos na paginacao do catalogo (a API de listagem nao tem rate limit agressivo).

### mode: "metrics"

1. Le `queue_total` e `metrics_done_count` de `discover_reports`
2. Seleciona N itens `pending` da `discover_report_queue` (ex: 500), atualiza para `processing` com `locked_at=now()`
3. Para cada island_code:
   - **Probe 1-dia**: `GET /islands/{code}/metrics/day?from=ontem&to=hoje`
   - Se uniquePlayers == 0 e plays == 0: upsert em `discover_report_islands` com status='suppressed', marcar queue como 'done'
   - Se tem dados: **Week 7d**: `GET /islands/{code}/metrics/day?from=7d&to=hoje`, calcular agregados, upsert com status='reported'
4. Concorrencia adaptativa:
   - Comeca com 15 paralelas
   - Se receber 429: reduz para metade, espera backoff exponencial
   - Se OK consecutivos: sobe devagar (+2)
   - Zero delays fixos entre batches
5. Atualiza contadores em `discover_reports`: `metrics_done_count`, `reported_count`, `suppressed_count`, `error_count`
6. Calcula `progress_pct = 10 + floor((metrics_done_count / queue_total) * 85)`, cap em 95
7. Se `metrics_done_count >= queue_total`: `phase='finalize'`
8. Retorna status, contadores, phase

### mode: "finalize"

1. Calcula KPIs via queries SQL em `discover_report_islands`:
   - `COUNT(*) WHERE status='reported'` para ilhas ativas
   - `SUM(week_plays)`, `AVG(week_d1_avg)`, etc.
   - `COUNT(DISTINCT creator_code)` para creators unicos
2. Calcula rankings via queries SQL:
   - `SELECT ... ORDER BY week_peak_ccu_max DESC LIMIT 10`
   - Para cada ranking (top CCU, top plays, top retention, etc.)
3. Detecta trends por keywords nos titulos (mesma logica atual, mas lendo de `discover_report_islands`)
4. Identifica novas ilhas comparando com `discover_islands`
5. Salva `platform_kpis` e `computed_rankings` em `discover_reports`
6. Muda `phase='ai'`, `progress_pct=95`

### mode: "ai" (fica em discover-report-ai)

Nenhuma mudanca estrutural, apenas:
- Monta payload compacto a partir dos KPIs + rankings ja calculados (sem truncar JSON)
- Chama a AI
- Marca `phase='done'`, `progress_pct=100`

### Funcoes auxiliares mantidas

- `fetchWithRetry` (com backoff adaptativo ao inves de fixo)
- `fetchIslandPage` (sem mudanca)
- `sumMetric`, `avgMetric`, `maxMetric`, `avgRetentionCalc` (sem mudanca)
- `processIslandMetrics` adaptado para gravar em `discover_report_islands`
- `detectTrends` lendo da tabela ao inves de array em memoria
- `topN` via SQL ao inves de sort em memoria

---

## Fase 3: Reescrever `src/pages/DiscoverTrendsList.tsx`

### Novo fluxo do botao "Gerar Report"

```text
1. invoke mode:"start" -> reportId, estimated_total
2. Loop: while phase == "catalog"
     invoke mode:"catalog"
     atualizar UI com catalog_discovered_count
3. Loop: while phase == "metrics"
     invoke mode:"metrics"
     atualizar UI com metrics_done_count / queue_total
4. invoke mode:"finalize"
5. invoke mode:"ai" (via discover-report-ai)
6. Done
```

### UI de progresso atualizada

- **Fase Catalog**: Barra indeterminada ou baseada em `estimated_total`, texto "Indexando ilhas... X encontradas"
- **Fase Metrics**: Barra precisa `metrics_done_count / queue_total`, com contadores de reported/suppressed/error
- **Fase Finalize**: 95%, "Calculando rankings..."
- **Fase AI**: 97%, "Gerando narrativas com IA..."
- **Done**: 100%

Grid de stats mostrar: Catalogadas, Na Fila, Com Dados, Suprimidas, Erros.

---

## Fase 4: Atualizar `discover-report-ai/index.ts`

- Payload compacto: usar o `computed_rankings` e `platform_kpis` ja calculados (nao truncar JSON)
- Aumentar slice de 10000 para enviar o payload completo (rankings ja sao top-10/top-20, entao cabem facilmente)

---

## Detalhes tecnicos de performance

### Eliminacao dos gargalos

| Gargalo atual | Solucao |
|---|---|
| raw_metrics JSON 10MB+ reescrito a cada batch | Tabela `discover_report_islands` (1 row = 1 ilha, append-only) |
| Dupla paginacao do catalogo | Fase catalog persiste codes na queue, metrics so le da queue |
| Delays fixos 50ms/100ms | Zero delays fixos; backoff apenas quando 429 |
| Sort O(n log n) em memoria para rankings | SQL `ORDER BY ... LIMIT 10` com indices |
| 20 paralelas fixas | Concorrencia adaptativa (15 base, sobe/desce conforme 429s) |
| 7d de metricas para ilhas mortas | Probe 1-dia primeiro; so puxa 7d se tiver dados |

### Concorrencia adaptativa (pseudocodigo)

```text
concurrency = 15
consecutiveOk = 0

for each batch:
  results = await Promise.all(batch.slice(0, concurrency).map(fetch))
  
  if any result is 429:
    concurrency = max(3, floor(concurrency / 2))
    consecutiveOk = 0
    wait(3s * attempts)
  else:
    consecutiveOk++
    if consecutiveOk >= 5 and concurrency < 30:
      concurrency += 2
```

---

## Ordem de execucao

1. **Migracoes SQL** -- adicionar colunas em `discover_reports`, criar `discover_report_queue` e `discover_report_islands` com RLS
2. **Reescrever `discover-collector/index.ts`** -- novo pipeline com 4 modos
3. **Reescrever `src/pages/DiscoverTrendsList.tsx`** -- novo fluxo de UI com fases
4. **Atualizar `discover-report-ai/index.ts`** -- payload compacto sem truncamento
5. **Deploy e teste**

---

## Resultado esperado

- **Zero perda de dados**: tudo persistido em tabelas relacionais, nao em JSON monolitico
- **Sem scan duplicado**: catalogo paginado 1 vez, queue consumida diretamente
- **Probe economico**: ilhas mortas nao gastam 7 chamadas de metricas
- **Progresso real**: `metrics_done_count / queue_total` direto do banco
- **Velocidade**: sem delays fixos + concorrencia adaptativa = throughput maximo respeitando rate limits
- **Sem limite fixo**: processa todas as ilhas que a API retornar

