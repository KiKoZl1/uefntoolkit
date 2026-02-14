# Plano: Turbo Mode - 274k ilhas em 1-2 horas

## Diagnostico


| Parametro atual          | Valor | Impacto             |
| ------------------------ | ----- | ------------------- |
| workers                  | 6     | OK, mas pode subir  |
| claimSizePerWorker       | 250   | Limita o lote       |
| workerInitialConcurrency | 10    | GARGALO PRINCIPAL   |
| workerMaxConcurrency     | 30    | Teto baixo          |
| workerBudgetMs           | 42000 | Pode subir um pouco |
| Tick interval (cron)     | 60s   | Tempo morto         |


Cada worker faz ~350 chamadas em 42s com concurrency=10. A Epic API responde em ~150ms e nao esta retornando 429. Ha margem enorme para subir.

## Mudancas propostas

### 1. Novo perfil de performance (discover-collector/index.ts)

```text
METRICS_V2_DEFAULTS (antes -> depois):
  workers:                    6  -> 10
  claimSizePerWorker:       250  -> 600
  workerInitialConcurrency:  10  -> 40
  workerMinConcurrency:       4  -> 8
  workerMaxConcurrency:      30  -> 80
  workerBudgetMs:         42000  -> 48000
  chunkSize:                300  -> 500
```

### 2. Reduzir intervalo do cron (SQL)

Alterar o job `discover-collector-orchestrate-minute` de `* * * * *` (1 min) para `*/30 * * * * *` (a cada 30 segundos) usando `pg_cron` com `cron.alter_job`.

Como o sistema ja tem protecao de overlap (verifica `last_metrics_tick_at < 45s`), basta reduzir o threshold para 25s para combinar com ticks mais frequentes.

### 3. Ajustar threshold de overlap (discover-collector/index.ts)

Reduzir o check de `45000ms` para `25000ms` no modo `orchestrate`, permitindo ticks mais frequentes.

## Projecao de throughput

```text
10 workers x 40 concurrency = 400 chamadas paralelas
Cada chamada ~150ms = ~2,666 chamadas/s teorico
Budget de 48s = ~8,000 chamadas efetivas por tick (com overhead de DB writes)
Conservador (50% eficiencia): ~4,000 por tick
Tick a cada ~55s (48s execucao + 7s overhead)
= ~4,300 ilhas/min

274k / 4,300 = ~64 min (~1 hora)
```

Mesmo com overhead de DB (upserts de 6,000 linhas por tick), o alvo de 1-2 horas e alcancavel.

## Riscos e mitigacoes


| Risco                         | Mitigacao                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------- |
| 429 da Epic com 400 paralelas | Backoff adaptativo ja existe; workerMinConcurrency=8 garante operacao minima |
| DB timeout com chunks maiores | chunkSize=500 ainda conservador; RPC batch ja e eficiente                    |
| Edge function timeout (>50s)  | workerBudgetMs=48s deixa 2s de margem; itens nao processados sao requeued    |
| Overlap de ticks              | Check de last_metrics_tick_at permanece ativo                                |


## Arquivos alterados

1. `supabase/functions/discover-collector/index.ts` - Novo perfil METRICS_V2_DEFAULTS + threshold de overlap
2. Migration SQL - Alterar intervalo do cron job para 30s

## Secao tecnica

### Detalhes do calculo de throughput

Cada worker opera assim dentro do budget:

1. Claim 600 ilhas via RPC (~100ms)
2. Preload cache (~200ms)
3. Skip suppressed_streak>=6 (instantaneo)
4. Loop de batches de 40 chamadas paralelas
  - Cada batch: 40 chamadas x ~150ms = ~150ms wall time
  - 600 ilhas / 40 = 15 batches = ~2.5s de API calls
  - Com overhead: ~5-8s por worker
5. Flush results: upserts + RPC batch (~3-5s)

Total por worker: ~10-15s, bem dentro do budget de 48s.

Os 10 workers rodam em paralelo via `Promise.all`, entao o tick inteiro leva o tempo do worker mais lento.

### Cron de 30s

O `pg_cron` padrao so suporta resolucao de 1 minuto. Para 30s, usaremos duas entradas cron defasadas ou um approach com `pg_cron` + schedule de segundo via extensao. Alternativa: manter 1 min mas compensar com throughput por tick (ja suficiente com o novo perfil).

Se 1 tick por minuto com ~4,000 ilhas ja da ~4,000/min = 274k em 68 min, o cron de 30s pode nao ser necessario. Recomendo comecar com o novo perfil mantendo 1 min e so reduzir se necessario.  
  
EXPOR NO PAINEL DE ADMIN ONDE FICA AS INFORMAÇÕES EM TEMPO REAL PARA O USUARIO EXPOR CASO ACONTEÇA CODE 429, E VOLTAR A EXPOR TAMBÉM AS ILHAS NULL QUE FORAM APRA LISTA DE SUPRIMIDAS 