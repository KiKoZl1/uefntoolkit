# Discover Panel Intelligence v1
## Documentacao completa dos calculos e algoritmos do `Ver timeline`

> Versao do documento: 2026-02-26
> 
> Escopo: describe com precisao o pipeline de metricas do modal `Ver timeline` no Discover.
> 
> Base de codigo considerada:
> - `supabase/migrations/20260226135000_discovery_panel_intel_flow_retry_metrics.sql`
> - `supabase/functions/discover-panel-timeline/index.ts`
> - `supabase/functions/discover-panel-intel-refresh/index.ts`
> - `supabase/migrations/20260226120000_discovery_panel_intel_snapshot.sql`
> - `supabase/migrations/20260226121000_discover_panel_intel_cron.sql`
> - `supabase/migrations/20260226124000_discover_panel_intel_cron_rpc_setup.sql`
> - `src/pages/public/DiscoverLive.tsx`

---

## 1) Objetivo funcional

O modal `Ver timeline` deixou de ser apenas um grafico bruto e passou a entregar inteligencia de painel:

1. Comportamento medio do painel na janela recente.
2. Faixas de desempenho do painel (`Ruim`, `Bom`, `Excelente`) com base estatistica.
3. Sinal operacional de permanencia (CCU minimo + minutos minimos).
4. Fluxo entre paineis (de onde entra / para onde vai).
5. Repeticao de tentativas e reentrada/abandono em 48h.

Importante:

- A inteligencia e de **painel** (tag), nao de ilha individual.
- O comparativo sempre respeita: **target + regiao + surface + painel**.
- O cliente final recebe apenas numericos e nomes publicos de paineis.
- Metodologia interna (percentis, filtros, CTEs) fica no backend.

---

## 2) Arquitetura de dados (visao de alto nivel)

### 2.1 Fluxo principal

1. O frontend abre `discover-panel-timeline` com:
   - `region`
   - `surfaceName`
   - `panelName`
   - `hours` (timeline curta, tipicamente 24h)
   - `windowDays` (benchmark, default 14)

2. A edge function:
   - calcula serie de 24h por hora (CCU/exposicao)
   - coleta `sample_top_items`
   - le snapshot de inteligencia em `discovery_panel_intel_snapshot`
   - recalcula on-demand se necessario
   - resolve nomes publicos de paineis
   - retorna payload consolidado

3. O frontend renderiza:
   - cards de inteligencia
   - faixas
   - sinais de permanencia
   - transicoes
   - tabelas `top proximos paineis` e `top paineis de origem`
   - graficos de ccu/minutos

### 2.2 Fluxo de manutencao (warm cache)

1. Cron chama `discover-panel-intel-refresh` a cada 10 min.
2. A refresh function seleciona targets ativos.
3. Para cada target, lista paineis recentes e recalcula painel-a-painel via RPC SQL.
4. Snapshot fica quente e leitura do modal tende a ser imediata.

---

## 3) Entidades e tabelas usadas

## 3.1 Tabela de snapshot

`public.discovery_panel_intel_snapshot`

Campos principais:

- `target_id` (uuid)
- `region` (text)
- `surface_name` (text)
- `panel_name` (text)
- `window_days` (int)
- `as_of` (timestamptz)
- `payload_json` (jsonb)
- `sample_stints` (int)
- `sample_closed_stints` (int)
- `active_maps_now` (int)
- `confidence` (`low|medium|high`)
- `updated_at` (timestamptz)

Chave primaria:

- `(target_id, panel_name, window_days)`

## 3.2 Tabelas de exposicao/historico

1. `discovery_exposure_targets`
   - mapeia target ativo por regiao/surface.

2. `discovery_exposure_presence_segments`
   - base de "stints" por ilha em painel.
   - campos relevantes: `start_ts`, `end_ts`, `last_seen_ts`, `ccu_start`, `ccu_end`, `ccu_max`, `closed_reason`.

3. `discovery_exposure_presence_events`
   - eventos `enter`/`exit` para entradas e saidas recentes.

4. `discovery_exposure_rank_segments`
   - segmentos de rank por painel/slot.
   - usado para `replacements_24h`.

5. `discover_link_metadata`
   - metadados de itens para `sample_top_items`.

6. `discovery_panel_tiers` + RPC `get_panel_display_name`
   - resolucao de nome publico de painel.

---

## 4) Parametros e janelas

## 4.1 Janela de timeline (curta)

- Campo de entrada: `hours`.
- Clamp aplicado no backend: `1 <= hours <= 168`.
- Uso tipico: `24h` para grafico do modal.

## 4.2 Janela de benchmark

- Campo de entrada: `windowDays`.
- Clamp aplicado: `1 <= windowDays <= 60`.
- Default operacional: `14 dias`.

## 4.3 Janela de stale para snapshot

- `PANEL_INTEL_STALE_MINUTES = 20`.
- Se `updated_at` > 20 min, tenta recalc on-demand.

## 4.4 Janela de rotacao imediata

- Entradas/Saidas/Replacements: `ultimas 24h`.

## 4.5 Janela de reentrada

- Reentrada e abandono: `48h` apos fechamento de stint.

---

## 5) Algoritmo da serie de timeline (CCU + minutos)

Implementado em `discover-panel-timeline`.

### 5.1 Selecionar segmentos do painel

Filtro:

- `target_id = alvo atual`
- `panel_name = painel solicitado`
- `start_ts < to`
- `end_ts IS NULL OR end_ts > from`

### 5.2 Bucketing horario

1. Arredonda `from` para hora (`floorToHour`).
2. Arredonda `to` para hora e soma +1 hora para limite exclusivo.
3. Cria buckets de 1h com estado:
   - `ccuWeighted`
   - `minutes_exposed`
   - `activeSet`
   - `itemsMinutes`

### 5.3 Intersecao segmento x bucket

Para cada segmento e bucket:

- `mins = overlapMinutes(segStart, segEnd, bucketStart, bucketEnd)`
- Se `mins <= 0`, ignora.

Atualizacao:

- `minutes_exposed += mins`
- `ccuWeighted += ccu * (mins / 60)`
- `activeSet.add(link_code)`
- `itemsMinutes[link_code] += mins`

Onde `ccu` do segmento no timeline curto usa fallback:

`ccu = ccu_end ?? ccu_max ?? ccu_start ?? 0`

### 5.4 Serie final

Para cada bucket:

- `ccu = round(ccuWeighted, 2)`
- `minutes_exposed = round(minutes_exposed, 2)`
- `active_items = activeSet.size`

A serie e ordenada por timestamp e enviada ao frontend.

---

## 6) Algoritmo de `sample_top_items`

1. Soma `minutes_exposed` por `link_code` a partir de `itemsMinutes` dos buckets.
2. Ordena por minutos desc.
3. Seleciona top 10.
4. Enriquece com `discover_link_metadata`:
   - `title`
   - `image_url`
   - `support_code`

Fallback de titulo:

- Se token tecnico (`reference_*`/`ref_panel_*`): `Unknown item`
- Senao: usa o proprio `link_code`.

---

## 7) Algoritmo SQL de inteligencia do painel

Implementado na RPC:

`public.compute_discovery_panel_intel_snapshot(...)`

### 7.1 Seguranca e pre-condicoes

1. Exige role `service_role`.
2. Resolve `region` e `surface_name` em `discovery_exposure_targets`.
3. Se target invalido, aborta com `target_not_found`.

### 7.2 Conjunto de paineis processados

`panel_source`:

- todos paineis com segmentos ativos na janela
- ou painel explicito (`p_panel_name`) quando informado

### 7.3 Montagem de stints base

`all_stint_base`:

- recorta cada stint na janela `[window_start, now]`:
  - `overlap_start = max(start_ts, window_start)`
  - `overlap_end = min(end_ts|last_seen_ts|now, now)`

`all_stint_enriched`:

- `stint_minutes = (overlap_end - overlap_start) / 60`
- `ccu_ref = media robusta de campos disponiveis`:
  - usa `ccu_start`, `ccu_end`, `ccu_max`
  - ignora ausentes
  - se todos ausentes -> `NULL`

### 7.4 Painel foco

`panel_stints` = subset de `all_stint_enriched` apenas para `panel_source`.

### 7.5 Media de CCU do painel (global de stints)

`panel_core.panel_avg_ccu`:

- media ponderada por minutos:

`sum(ccu_ref * stint_minutes) / sum(stint_minutes)`

somente onde `ccu_ref` nao e nulo.

### 7.6 Benchmark operacional (filtro anti-outlier)

Para bandas e permanencia, nao usa qualquer stint.

Fluxo:

1. `closed_stints`: apenas stints com `end_ts IS NOT NULL`.
2. `closed_operational`: somente stints com `stint_minutes <= 180`.
3. `benchmark_stints`:
   - usa `closed_operational`
   - fallback para `closed_stints` se nao houver nenhum <=180

Objetivo:

- reduzir distorcao de ilhas residentes/extremamente persistentes.

### 7.7 Metricas de exposicao media

Em `panel_stint` sobre `benchmark_stints`:

1. `sample_stints = count(*)`
2. `sample_closed_stints = count(*)`
3. `avg_exposure_minutes_per_stint = avg(stint_minutes)`
4. `avg_exposure_minutes_per_map = sum(stint_minutes)/count(distinct link_code)`

### 7.8 Bandas de CCU e de exposicao

`panel_percentiles` em `benchmark_stints`:

- `ccu_p40 = percentile_cont(0.40)` em `ccu_ref`
- `ccu_p80 = percentile_cont(0.80)` em `ccu_ref`
- `mins_p40 = percentile_cont(0.40)` em `stint_minutes`
- `mins_p80 = percentile_cont(0.80)` em `stint_minutes`

Mapeamento final:

- `Ruim`: `< P40`
- `Bom`: `>= P40`
- `Excelente`: `>= P80`

### 7.9 Sinal de risco de remocao e saida tipica

Ainda em `panel_percentiles`:

- `removal_risk_ccu_floor = percentile_cont(0.35)` de `ccu_end`
- `typical_exit_minutes = percentile_cont(0.50)` de `stint_minutes`

Base: `benchmark_stints`.

### 7.10 Meta de permanencia (keep alive)

`keep_alive_ccu_min = max(removal_risk_ccu_floor, ccu_p40)`

`keep_alive_minutes_min = coalesce(typical_exit_minutes, mins_p40, 0)`

Interpretacao:

- ccu minimo: limiar conservador entre piso de saida e banda boa.
- minutos minimos: mediana de permanencia da amostra operacional.

### 7.11 Entradas, saidas e trocas de slot

`panel_events` (24h):

- `entries_24h = count(event_type='enter')`
- `exits_24h = count(event_type='exit')`

`panel_replacements` (24h):

- `replacements_24h = count(rank_segment closed_reason='replaced')`

### 7.12 Ativos agora

`panel_active_now`:

- `active_maps_now = count(distinct link_code)`
- em `presence_segments` com `end_ts IS NULL`

### 7.13 Algoritmo de transicao para "proximos paineis"

Objetivo:

- apos uma ilha fechar stint no painel A, medir para qual painel ela vai em seguida.

Etapas:

1. `next_after_close`:
   - para cada stint fechado de A,
   - faz `JOIN LATERAL` pegando o primeiro stint futuro da mesma ilha,
   - exige painel diferente.
   - calcula `gap_minutes = next.overlap_start - close.overlap_end`.

2. `next_counts`:
   - agrega por `source_panel, next_panel`.
   - calcula `cnt` e `gap_p50`.

3. `next_ranked`:
   - calcula `total_cnt` por painel origem.
   - rankeia por frequencia desc.

4. `next_agg`:
   - `transitions_out_total = total_cnt`
   - `top_next_panels = top 5` com:
     - `panel_name`
     - `count`
     - `share_pct = count/total_cnt*100`
     - `median_gap_minutes = gap_p50`

### 7.14 Algoritmo de "paineis de origem"

Objetivo:

- antes de entrar no painel A, descobrir de qual painel vinha.

Etapas:

1. `prev_before_entry`:
   - para cada stint de A,
   - `JOIN LATERAL` no stint imediatamente anterior da mesma ilha,
   - exige painel diferente,
   - coleta `prev_ccu_end` e `gap_minutes`.

2. `prev_counts` / `prev_ranked` / `prev_agg`:
   - analogos ao fluxo de proximos paineis.

3. `prev_stats`:
   - `entry_prev_ccu_p50`
   - `entry_prev_ccu_p80`
   - `entry_prev_gap_minutes_p50`

### 7.15 Algoritmo de tentativas por ilha

`panel_island_attempts`:

- por painel + ilha: `attempts = count(stints)`

`attempts_stats`:

- `attempts_avg_per_island = avg(attempts)`
- `attempts_p50_per_island = p50(attempts)`
- `islands_single_attempt_pct`
- `islands_multi_attempt_pct`

### 7.16 Algoritmo de reentrada e abandono (48h)

1. `closed_attempts`:
   - ordena stints fechados por ilha/painel e gera `attempt_index`.

2. `closed_flags`:
   - para cada fechamento, marca `has_reentry_48h` se existe novo stint
   - mesma ilha + mesmo painel
   - `overlap_start <= overlap_end + 48h`

3. `retry_stats`:
   - `reentry_48h_pct`
   - `abandon_48h_pct`
   - `attempts_before_abandon_avg`
   - `attempts_before_abandon_p50`

### 7.17 Regra de confianca

No snapshot atual:

- `high`: `sample_stints >= 120` e `sample_closed_stints >= 40`
- `medium`: `sample_stints >= 60` e `sample_closed_stints >= 20`
- `low`: resto

Observacao:

- Hoje esse campo e salvo no snapshot, mas nao e exibido no modal publico.

### 7.18 Persistencia final

A funcao faz `upsert` em `discovery_panel_intel_snapshot`.

`payload_json` inclui numericos arredondados:

- varias metricas em 2 casas
- percentuais em 1 casa
- arrays `top_next_panels`/`top_prev_panels`

---

## 8) Algoritmo de leitura no endpoint `discover-panel-timeline`

### 8.1 Selecao do snapshot

Consulta por:

- `target_id`
- `panel_name`
- `window_days`

### 8.2 Recalculo on-demand

Recalcula quando:

1. snapshot inexistente
2. snapshot stale (>20 min)
3. snapshot sem campos novos (upgrade guard)

### 8.3 Montagem de `panel_intel`

`buildPanelIntel(...)` transforma `payload_json` em estrutura tipada:

- valores nulos preservados
- numericos parseados
- arrays parseados e truncados em top 5

### 8.4 Resolucao de nome publico de painel

A edge resolve display names para:

- painel principal
- paineis de origem
- paineis de destino

Ordem de resolucao:

1. `discovery_panel_tiers.label`
2. RPC `get_panel_display_name(p_panel_name)`
3. normalizacao local (`normalizePanelDisplayName`)

Higienizacao:

- remove codigos tecnicos (`Nested_*`, `Browse_*`, etc.)
- converte camel/snake para texto legivel

### 8.5 Resultado final retornado

Campos principais:

- `series[]`
- `sample_top_items[]`
- `panel_intel` (metricas benchmark)
- `panelDisplayName`

---

## 9) Algoritmo de refresh em lote (`discover-panel-intel-refresh`)

### 9.1 Seguranca

Aceita apenas service role.

Validacoes:

- token exato da service key
- ou JWT com role `service_role` e `ref` correto

### 9.2 Selecao de targets

Filtra `discovery_exposure_targets` por:

- `surface_name`
- regioes solicitadas (default `NAE/EU/BR/ASIA`)
- `last_ok_tick_at` nao nulo
- `last_ok_tick_at >= now - activeWithinHours`

Ordena por `last_ok_tick_at desc`, limita por `batchTargets`.

### 9.3 Selecao de paineis por target

Para cada target:

- consulta `discovery_exposure_presence_segments`
- periodo `start_ts >= now - windowDays`
- `link_code_type = island`
- extrai lista unica de `panel_name`
- limita por `maxPanelsPerTarget`

### 9.4 Recalculo granular

Recalcula **painel-a-painel**:

- chama RPC com `p_panel_name` especifico
- evita timeout de recalculo global monolitico

Acumula:

- `processed_targets`
- `processed_panels`
- `errors[]`

---

## 10) Cron e operacao

### 10.1 Cron automatico

Migration cria job:

- nome: `discover-panel-intel-refresh-10min`
- schedule: `*/10 * * * *`
- endpoint: `/functions/v1/discover-panel-intel-refresh`

Payload default do cron:

- `surfaceName = CreativeDiscoverySurface_Frontend`
- `windowDays = 14`
- `batchTargets = 16`
- `regions = [NAE, EU, BR, ASIA]`

### 10.2 RPC administrativa de setup

`setup_discover_panel_intel_refresh_cron(...)`

Permite:

- ajustar URL
- chave
- schedule
- janela
- batch

Sem service role -> `forbidden`.

---

## 11) Mapeamento exato para UI (`DiscoverLive`)

### 11.1 Cards principais de inteligencia

1. `panel_avg_ccu`
2. `avg_exposure_minutes_per_stint`
3. `entries_24h` / `exits_24h`
4. `replacements_24h`

### 11.2 Bandas

CCU:

- `ccu_bands.ruim_lt`
- `ccu_bands.bom_gte`
- `ccu_bands.excelente_gte`

Exposicao:

- `exposure_bands_minutes.ruim_lt`
- `exposure_bands_minutes.bom_gte`
- `exposure_bands_minutes.excelente_gte`

### 11.3 Permanencia

- `keep_alive_targets.ccu_min`
- `keep_alive_targets.minutes_min`

### 11.4 Fluxo entre paineis

- `transitions_out_total`
- `transitions_in_total`
- `entry_prev_gap_minutes_p50`
- tabela `top_next_panels`
- tabela `top_prev_panels`

### 11.5 Tentativas e reentrada

- `attempts_avg_per_island`
- `attempts_p50_per_island`
- `reentry_48h_pct`
- `abandon_48h_pct`

### 11.6 Graficos de serie curta

- `series[].ccu`
- `series[].minutes_exposed`

---

## 12) Formulas (resumo matematico)

Considere painel `P`, janela `W`, conjunto de stints `S`.

### 12.1 Duracao de stint recortado

`stint_minutes(s) = (min(end_s, now) - max(start_s, W.start)) / 60`

### 12.2 CCU de referencia por stint

`ccu_ref(s) = media({ccu_start, ccu_end, ccu_max} disponiveis)`

### 12.3 Media de CCU do painel

`panel_avg_ccu = sum(ccu_ref * stint_minutes) / sum(stint_minutes)`

### 12.4 Bandas

`ccu_p40 = P40(ccu_ref)`

`ccu_p80 = P80(ccu_ref)`

`mins_p40 = P40(stint_minutes)`

`mins_p80 = P80(stint_minutes)`

### 12.5 Risco/saida

`removal_risk_ccu_floor = P35(ccu_end)`

`typical_exit_minutes = P50(stint_minutes)`

### 12.6 Keep alive

`keep_alive_ccu_min = max(removal_risk_ccu_floor, ccu_p40)`

`keep_alive_minutes_min = coalesce(typical_exit_minutes, mins_p40)`

### 12.7 Share em top panels

`share_pct(panel_i) = count_i / sum(count_j) * 100`

---

## 13) Regras de normalizacao e filtros

1. Apenas `link_code_type = 'island'` entra no benchmark.
2. Collections ficam fora da inteligencia de painel.
3. Segmentos invalidos (`overlap_end <= overlap_start`) sao descartados.
4. Benchmark usa stints fechados, com corte operacional <=180 min.
5. Se nao houver nenhum stint <=180 min, cai para todos fechados.
6. Arrays de top panels limitados a 5 linhas.

---

## 14) Como interpretar as metricas (operacional)

### 14.1 Pressao de entrada

Use `ccu_bands`:

- abaixo de `ruim_lt`: baixo potencial de sustentacao
- acima de `bom_gte`: zona minima competitiva
- acima de `excelente_gte`: faixa de alta performance

### 14.2 Rotacao do painel

Use:

- `entries_24h`, `exits_24h`, `replacements_24h`

Painel com valores altos = mais volatil.

### 14.3 Chance de permanencia

Use `keep_alive_targets`:

- meta de tracao simultanea (CCU + minutos)

### 14.4 Fluxo natural de progressao

Use:

- `top_next_panels`
- `top_prev_panels`
- `entry_prev_gap_minutes_p50`

Isso mostra conexoes historicas reais entre paineis.

### 14.5 Persistencia de tentativa

Use:

- `attempts_avg_per_island`
- `reentry_48h_pct`
- `abandon_48h_pct`

Alta reentrada = painel em que ilhas voltam a ser testadas.

---

## 15) Limites e vieses conhecidos

1. Dependencia de qualidade de ingestao de segmentos/eventos.
2. Painel com amostra baixa gera ruido maior em percentis.
3. `gap_minutes` pode inflar quando ilha some e retorna muito depois.
4. Grandes mudancas de algoritmo da Epic alteram baseline rapidamente.
5. Rotulos publicos dependem de catalogo/heuristica de nome.

---

## 16) Sinais de anomalia (diagnostico)

Se observar valores estranhos:

1. Verificar `sample_stints` e `sample_closed_stints`.
2. Verificar se painel teve poucos fechamentos na janela.
3. Verificar se refresh cron esta com timeout em paineis pesados.
4. Verificar se snapshot esta stale e sem recalc.
5. Verificar se houve burst de ilhas residentes (antes do filtro operacional).

---

## 17) Consultas SQL uteis para auditoria

### 17.1 Snapshot atual de um painel

```sql
select
  target_id,
  region,
  surface_name,
  panel_name,
  window_days,
  updated_at,
  payload_json
from discovery_panel_intel_snapshot
where region = 'NAE'
  and surface_name = 'CreativeDiscoverySurface_Frontend'
  and panel_name = 'Nested_Popular'
  and window_days = 14;
```

### 17.2 Recalculo manual de um painel

```sql
select public.compute_discovery_panel_intel_snapshot(
  p_target_id := '43de14fb-383f-4f9c-aead-d28db93663ed'::uuid,
  p_window_days := 14,
  p_panel_name := 'Nested_Popular'
);
```

### 17.3 Top paineis por transicao (payload)

```sql
select
  panel_name,
  payload_json -> 'top_next_panels' as top_next,
  payload_json -> 'top_prev_panels' as top_prev
from discovery_panel_intel_snapshot
where target_id = '43de14fb-383f-4f9c-aead-d28db93663ed'::uuid
  and window_days = 14;
```

### 17.4 Conferencia de stints operacionais (<=180)

```sql
with s as (
  select
    panel_name,
    extract(epoch from (
      least(coalesce(end_ts, last_seen_ts, now()), now())
      - greatest(start_ts, now() - interval '14 days')
    )) / 60.0 as stint_minutes,
    end_ts
  from discovery_exposure_presence_segments
  where target_id = '43de14fb-383f-4f9c-aead-d28db93663ed'::uuid
    and link_code_type = 'island'
    and start_ts < now()
    and coalesce(end_ts, last_seen_ts, now()) > now() - interval '14 days'
)
select
  panel_name,
  count(*) filter (where end_ts is not null and stint_minutes > 0) as closed_stints,
  count(*) filter (where end_ts is not null and stint_minutes > 0 and stint_minutes <= 180) as closed_operational
from s
group by panel_name
order by panel_name;
```

### 17.5 Entradas/saidas 24h por painel

```sql
select
  panel_name,
  count(*) filter (where event_type = 'enter') as entries_24h,
  count(*) filter (where event_type = 'exit') as exits_24h
from discovery_exposure_presence_events
where target_id = '43de14fb-383f-4f9c-aead-d28db93663ed'::uuid
  and ts >= now() - interval '24 hours'
group by panel_name
order by entries_24h desc;
```

---

## 18) Contrato de resposta do endpoint (resumo pratico)

`discover-panel-timeline` retorna:

```json
{
  "success": true,
  "region": "NAE",
  "surfaceName": "CreativeDiscoverySurface_Frontend",
  "panelName": "Nested_Popular",
  "panelDisplayName": "Popular",
  "from": "...",
  "to": "...",
  "hours": 24,
  "series": [ ... ],
  "sample_top_items": [ ... ],
  "panel_intel": {
    "panel_avg_ccu": 5671.6,
    "avg_exposure_minutes_per_stint": 91.34,
    "entries_24h": 43,
    "exits_24h": 43,
    "replacements_24h": 263,
    "ccu_bands": { ... },
    "exposure_bands_minutes": { ... },
    "keep_alive_targets": { ... },
    "transitions_out_total": 162,
    "top_next_panels": [ ... ],
    "transitions_in_total": 172,
    "top_prev_panels": [ ... ],
    "attempts_avg_per_island": 5.27,
    "reentry_48h_pct": 83.3,
    "abandon_48h_pct": 16.7
  }
}
```

---

## 19) Glossario rapido

- **Painel**: trilho/tag do Discover.
- **Stint**: permanencia continua de uma ilha em um painel.
- **Closed stint**: stint encerrado (`end_ts` definido).
- **Reentry 48h**: ilha retorna ao mesmo painel ate 48h apos sair.
- **Abandon 48h**: nao retorna ao mesmo painel nesse intervalo.
- **Replacement**: troca de slot detectada em rank segment (`closed_reason='replaced'`).
- **Keep alive**: alvo operacional minimo para sustentar presenca.

---

## 20) Historico de versao do algoritmo

1. Snapshot inicial (`20260226120000`):
   - estrutura base de inteligencia.

2. Ajuste operacional (`20260226132000`):
   - benchmark por stints fechados e corte <=180 min.

3. Expansao de previsibilidade (`20260226135000`):
   - transicoes origem/destino,
   - estatisticas de entrada,
   - repeticao de tentativas,
   - reentrada/abandono 48h.

---

## 21) Estado atual e recomendacoes de uso

Estado atual do v1:

1. Calcula e exibe inteligencia robusta de painel.
2. Usa filtros operacionais para reduzir ilhas fora da curva.
3. Mostra fluxo inter-paineis por comportamento observado.
4. Mantem nome publico dos paineis no modal.

Recomendacao operacional:

1. Ler `ccu_bands + keep_alive_targets` como baseline do painel.
2. Ler `entries/exits/replacements` para ritmo de rotacao diario.
3. Ler `top_prev/top_next` para entender ciclo de distribuicao do Discover.
4. Ler `reentry/abandon` para inferir tolerancia de re-teste do painel.

---

## 22) Checklist de validacao quando houver mudanca de algoritmo

1. `npm run build` sem erro.
2. `discover-panel-timeline` retorna `panelDisplayName` publico.
3. `panel_intel` contem campos novos esperados.
4. Arrays `top_next_panels` e `top_prev_panels` sem codigos tecnicos no frontend.
5. Cron `discover-panel-intel-refresh-10min` ativo.
6. Nenhum painel critico com timeout recorrente no refresh.

---

## 23) Nota de implementacao sobre exibicao ao cliente

Mesmo com metodologia estatistica completa no backend:

- UI final deve continuar mostrando apenas:
  - valores,
  - faixas,
  - comparativos,
  - nomes publicos de paineis.

Nao exibir no modal publico:

- percentis explicitamente nomeados,
- detalhes de CTE,
- termos internos de calibracao.

A documentacao atual existe para engenharia e auditoria tecnica.
