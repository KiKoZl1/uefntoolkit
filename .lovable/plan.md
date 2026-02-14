# Fase 2 -- Incremental Weekly Reports (Cache Global + Novas/Mortas/Revividas + WoW)

## Resumo

Adicionar uma camada de cache global (`discover_islands_cache`) que armazena o ultimo estado conhecido de cada ilha, habilitando: deteccao automatica de ilhas novas/mortas/revividas, priorizacao inteligente da fila de metricas, comparativos Week-over-Week quantitativos, e reducao de chamadas desnecessarias a API da Epic.

---

## 1. Nova tabela: `discover_islands_cache`

```text
island_code       TEXT PRIMARY KEY
title             TEXT
creator_code      TEXT
category          TEXT
created_in        TEXT
tags              JSONB DEFAULT '[]'
first_seen_at     TIMESTAMPTZ DEFAULT now()
last_seen_at      TIMESTAMPTZ DEFAULT now()
last_status       TEXT           -- reported | suppressed
suppressed_streak INT DEFAULT 0
reported_streak   INT DEFAULT 0
last_report_id    UUID NULL
last_reported_at  TIMESTAMPTZ NULL
last_suppressed_at TIMESTAMPTZ NULL
last_probe_unique INT NULL
last_probe_plays  INT NULL
last_week_unique  INT NULL
last_week_plays   INT NULL
last_week_minutes INT NULL
last_week_peak_ccu INT NULL
last_week_favorites INT NULL
last_week_recommends INT NULL
last_week_d1_avg  FLOAT NULL
last_week_d7_avg  FLOAT NULL
last_week_minutes_per_player_avg FLOAT NULL
updated_at        TIMESTAMPTZ DEFAULT now()
```

Indices: `(creator_code)`, `(last_status)`, `(suppressed_streak)`, `(last_reported_at)`.

RLS: service_role para INSERT/UPDATE/DELETE, authenticated para SELECT.

---

## 2. Modificacoes no `discover-collector/index.ts`

### 2.1 Mode "metrics" -- Write-through no cache

Apos cada upsert em `discover_report_islands`, tambem fazer upsert em `discover_islands_cache`:

- Se ilha nova (nao existia): `first_seen_at = now()`
- Se `status = reported`: incrementar `reported_streak`, zerar `suppressed_streak`, salvar todos os `last_week_*` e `last_probe_*`
- Se `status = suppressed`: incrementar `suppressed_streak`, zerar `reported_streak`
- Sempre atualizar `last_seen_at`, `last_report_id`, metadata

### 2.2 Mode "metrics" -- Priorizacao da fila

Ao buscar itens `pending` da `discover_report_queue`, fazer JOIN com `discover_islands_cache` e ordenar por prioridade:

```text
1. last_status = 'reported' (mais provavel ter dados)
2. ilha nova (nao existe no cache)
3. suppressed_streak <= 2
4. suppressed_streak > 2
```

Implementacao: adicionar coluna `priority` INT na query ou usar ORDER BY com CASE.

### 2.3 Mode "metrics" -- Skip para suppressed_streak >= 6

Para ilhas com `suppressed_streak >= 6` e `last_reported_at` mais de 60 dias atras (ou NULL):

- Marcar diretamente como `suppressed` sem chamar a API
- Adicionar flag `assumed = true` no upsert
- Revalidar 10% dessas por amostragem aleatoria (a cada report)

### 2.4 Mode "metrics" -- Reported direto para week

Para ilhas com `last_status = 'reported'` no cache:

- Ir direto para fetch de 7 dias (ja faz isso hoje)
- Nenhuma mudanca de logica, mas a priorizacao garante que essas sao processadas primeiro

### 2.5 Mode "finalize" -- Novas secoes do ranking

Adicionar ao `computedRankings`:

**Ilhas novas da semana** (via cache):

- `SELECT * FROM discover_islands_cache WHERE first_seen_at >= report.week_start`

**Criadores novos** (via cache):

- `SELECT DISTINCT creator_code FROM discover_islands_cache WHERE first_seen_at >= report.week_start` que nao existiam antes

**Ilhas revividas** (suppressed -> reported):

- `SELECT * FROM discover_islands_cache WHERE last_status = 'reported' AND last_suppressed_at IS NOT NULL AND last_suppressed_at > last_reported_at - interval '14 days'`
- Ou mais simples: ilhas onde `reported_streak = 1` e `suppressed_streak` anterior era > 0

**Ilhas que morreram** (reported -> suppressed):

- Ilhas no report anterior com `status = 'reported'` que agora estao `suppressed`

**Week-over-Week deltas**:

- Para cada ilha reported, calcular delta vs `last_week_*` do cache (que contem valores do report anterior)
- Campos: `delta_plays`, `delta_unique`, `delta_minutes`, `delta_peak_ccu`, `delta_favorites`, `delta_recommends`

Novos rankings:

- `topRisers` (maior crescimento absoluto em plays)
- `topDecliners` (maior queda)
- `breakouts` (de suppressed para top reported)
- `revivedIslands` (lista de revividas)
- `deadIslands` (lista de mortas)

### 2.6 Mode "finalize" -- KPIs WoW

Adicionar ao `platformKPIs`:

- `wowTotalPlays`, `wowTotalPlayers`, `wowTotalMinutes` (delta vs report anterior)
- `wowActiveIslands`, `wowNewMaps`, `wowNewCreators`

Buscar do report anterior: `SELECT platform_kpis FROM discover_reports WHERE phase='done' ORDER BY created_at DESC LIMIT 1 OFFSET 1`

---

## 3. Adicionar coluna `priority` na `discover_report_queue`

Nova coluna para ordenacao inteligente:

```text
ALTER TABLE discover_report_queue ADD COLUMN priority INT DEFAULT 50;
```

Valores:

- 10 = reported no cache (alta prioridade)
- 20 = ilha nova (nao no cache)
- 30 = suppressed_streak <= 2
- 50 = default / suppressed_streak > 2

Populada durante a fase "catalog" ao inserir na queue, fazendo lookup no cache.

---

## 4. Modificacoes no Frontend

### 4.1 `DiscoverTrendsReport.tsx`

Adicionar novas secoes visuais:

- Secao "Ilhas Revividas" com RankingTable
- Secao "Ilhas que Morreram" com RankingTable
- Secao "Top Risers / Decliners" com barras de delta (verde/vermelho)
- KPIs com setas WoW (ja existe a memoria sobre isso)

### 4.2 `DiscoverTrendsList.tsx`

Nenhuma mudanca estrutural. O pipeline continua igual, apenas mais rapido por causa do skip de ilhas mortas cronicas.

---

## 5. Atualizar `discover-report-ai/index.ts`

Adicionar ao prompt da IA:

- Dados de ilhas revividas/mortas
- Top risers/decliners
- Deltas WoW nos KPIs
- Novos criadores com contexto

---

## 6. Ordem de execucao

1. Migracao SQL: criar `discover_islands_cache` + adicionar `priority` na queue
2. Atualizar `discover-collector` mode "catalog": popular priority via lookup no cache
3. Atualizar `discover-collector` mode "metrics": write-through no cache + skip suppressed cronicas + ordenacao por priority
4. Atualizar `discover-collector` mode "finalize": novas secoes (revividas, mortas, risers, decliners, WoW)
5. Atualizar `discover-report-ai`: prompt com novos dados
6. Atualizar `DiscoverTrendsReport.tsx`: novas secoes visuais + WoW nos KPIs

---

## 7. Resultado esperado

- **Reports incrementais mais rapidos**: skip de ~96% das ilhas mortas cronicas sem chamar API
- **Priorizacao inteligente**: ilhas ativas processadas primeiro = report parcial util mais cedo
- **Insights novos sem custo extra**: novas/mortas/revividas/risers/decliners vem do cache
- **WoW quantitativo**: deltas reais ao inves de apenas keywords
- **Cache global reutilizavel**: base para futuras features (historico de ilha, perfil de criador, etc.)
- Lembrar de criar novas areas para novas informações nos relatorios 