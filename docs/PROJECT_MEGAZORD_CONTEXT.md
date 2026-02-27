# Epic Insight Engine — Contexto Completo do Projeto ("Megazord")

## 1) O que é esta plataforma
O **Epic Insight Engine** é uma plataforma de inteligência de dados para o ecossistema **Fortnite UGC / Discovery**.

Em termos práticos, ela transforma sinais brutos da Epic (ilhas, painéis/tags, exposição, métricas de tráfego e metadados) em:

1. produtos públicos (Discover Live, páginas de ilha, reports),
2. produtos autenticados para usuários (lookup e analytics),
3. camada operacional/admin (saúde de pipeline, cron, alertas, qualidade de dados),
4. camada de automação contínua (Ralph).

---

## 2) Problema que a plataforma resolve
Criadores e operadores de UGC normalmente têm:

1. dados fragmentados,
2. pouca explicação de "por que subi/caí de painel",
3. dificuldade de comparar desempenho por categoria/painel,
4. pouca previsibilidade para tomada de decisão.

O projeto resolve isso consolidando dados históricos e live, e entregando leitura acionável:

1. o que está acontecendo,
2. por que está acontecendo,
3. qual referência de benchmark,
4. o que fazer a seguir.

---

## 3) Objetivo final da plataforma
Transformar o produto em um **sistema operacional de decisão para criadores Fortnite UGC**, com:

1. diagnóstico confiável de performance,
2. inteligência de exposição (painéis/tags),
3. monitoramento contínuo do ecossistema,
4. automação incremental de melhoria de produto/dados (Ralph),
5. base robusta para recursos premium de previsibilidade e recomendação.

Resumo de visão: **sair de dashboard descritivo para motor de decisão orientado por evidência**.

---

## 4) Público-alvo

1. **Criadores de ilhas** (entender tração, retenção e exposição).
2. **Times operacionais/editoriais** (monitorar saúde do Discover e pipelines).
3. **Admins internos** (qualidade, cron, incidentes, backlog, cobertura).

---

## 5) Stack e base técnica

## Frontend
1. React 18 + TypeScript + Vite
2. Tailwind + shadcn/ui
3. TanStack Query
4. Recharts
5. React Router

## Backend/Data
1. Supabase (Postgres + RLS + Auth + Edge Functions + pg_cron)
2. Migrations em `supabase/migrations` como fonte canônica de schema e RPCs
3. Funções Edge em `supabase/functions`

## AI/LLM
1. **NVIDIA (padrão)** com `moonshotai/kimi-k2.5` para loops Ralph
2. OpenAI como fallback em fluxos selecionados
3. Memória operacional + memória semântica para contexto persistente

---

## 6) Módulos principais do produto

## 6.1 Camada pública
Rotas:
1. `/`
2. `/discover`
3. `/island?code=XXXX-XXXX-XXXX`
4. `/reports`
5. `/reports/:slug`

Principais entregas:
1. **Discover Live** com trilhos/painéis e timeline por painel.
2. **Página pública de ilha** com métricas e séries.
3. **Reports públicos semanais**.

## 6.2 Camada autenticada (`/app`)
1. Dashboard de projetos
2. Upload/relatórios por projeto
3. Island Lookup para consulta e diagnóstico de ilhas

## 6.3 Camada admin (`/admin`)
1. Command Center
2. Reports CMS/editor
3. Exposure Health
4. Intel
5. Panels manager

---

## 7) Pipelines e domínios de dados

## 7.1 Weekly Report Pipeline
Tabelas-chave:
1. `discover_reports`
2. `discover_report_queue`
3. `discover_report_islands`
4. `weekly_reports`

Objetivo:
1. processar semana,
2. consolidar métricas,
3. gerar seções/rankings,
4. publicar payload final.

## 7.2 Exposure Pipeline (núcleo de visibilidade no Discover)
Tabelas-chave:
1. `discovery_exposure_targets`
2. `discovery_exposure_ticks`
3. `discovery_exposure_presence_events`
4. `discovery_exposure_presence_segments`
5. `discovery_exposure_rank_segments`
6. `discovery_exposure_rollup_daily`

Objetivo:
1. registrar presença por painel/rank ao longo do tempo,
2. produzir histórico de entrada/saída/substituição,
3. habilitar inteligência de painel e exposição.

## 7.3 Metadata/Graph
Tabelas-chave:
1. `discover_islands_cache`
2. `discover_link_metadata`
3. `discover_link_metadata_events`
4. `discover_link_edges`

Objetivo:
1. enriquecer ilhas com metadados,
2. manter eventos de mudança,
3. resolver referências indiretas entre links/painéis/coleções.

## 7.4 Public Intel
Tabelas-chave:
1. `discovery_public_premium_now`
2. `discovery_public_emerging_now`
3. `discovery_public_pollution_creators_now`
4. `discovery_panel_tiers`

Objetivo:
1. alimentar superfícies públicas rápidas,
2. monitorar tendências e qualidade do ecossistema.

---

## 8) Edge Functions (principais domínios)
Exemplos relevantes no projeto:

1. `discover-collector`
2. `discover-report-rebuild`
3. `discover-report-ai`
4. `discover-exposure-collector`
5. `discover-exposure-report`
6. `discover-exposure-timeline`
7. `discover-links-metadata-collector`
8. `discover-rails-resolver`
9. `discover-panel-timeline`
10. `discover-island-lookup`
11. `discover-island-lookup-ai`
12. `ai-analyst`
13. `discover-enqueue-gap`

---

## 9) O que é o Ralph dentro desse projeto
**Ralph não é o modelo.** Ralph é o orquestrador de melhoria contínua do produto/plataforma.

Ele opera por runs com:
1. escopo,
2. limites de iteração/tempo,
3. trilha de auditoria,
4. gates de qualidade.

Principais tabelas operacionais:
1. `ralph_runs`
2. `ralph_actions`
3. `ralph_eval_results`
4. `ralph_incidents`

Objetivo do Ralph:
1. acelerar evolução de produto com segurança,
2. manter rastreabilidade,
3. impedir automação sem controle humano.

---

## 10) Kimi k2.5 e modelo de IA
No estado atual, o fluxo recomendado é:

1. Provedor NVIDIA
2. Modelo principal: `moonshotai/kimi-k2.5`
3. Embeddings: NVIDIA (`nvidia/nv-embedqa-e5-v5`) na camada semântica
4. OpenAI como fallback opcional

Uso típico:
1. loops Ralph (planejamento/execução guiada),
2. síntese de insights,
3. apoio à qualidade de texto/diagnóstico.

---

## 11) Memória operacional + semântica (Ralph)

## Memória operacional
1. snapshots de saúde da plataforma,
2. itens de memória com evidência,
3. contexto de run para reduzir perda de estado entre sessões.

Tabelas:
1. `ralph_memory_snapshots`
2. `ralph_memory_items`
3. `ralph_memory_decisions`

## Memória semântica
1. documentos chunkados do projeto,
2. busca híbrida (vetorial + textual),
3. injeção de contexto relevante no loop.

Tabela:
1. `ralph_memory_documents`

Resultado: evolução cumulativa (menos repetição, mais continuidade).

---

## 12) Features já materializadas (macro)

1. Discover Live com estrutura de trilhos.
2. Timeline por painel com inteligência agregada.
3. Página pública de detalhe de ilha.
4. Island Lookup autenticado.
5. Reports semanais e CMS de publicação.
6. Admin Command Center com sinais operacionais.
7. Camada de memória Ralph (operacional + semântica).

---

## 13) O que este "Megazord" está construindo de verdade
Não é só uma UI com gráficos. É um sistema com 4 engrenagens acopladas:

1. **Coleta** (ingestão contínua de sinais),
2. **Modelagem** (segmentos, eventos, rollups, intel),
3. **Produto** (discover, lookup, island page, reports),
4. **Operação autônoma assistida** (Ralph com gates e memória).

Esse acoplamento é o diferencial e também a complexidade do projeto.

---

## 14) Como explicar em 30 segundos (pitch)
“O Epic Insight Engine é uma plataforma que observa o Discovery do Fortnite em tempo real, transforma isso em inteligência acionável para criadores e operadores, e usa um orquestrador (Ralph + Kimi k2.5) para evoluir continuamente o produto com segurança operacional. O objetivo final é virar o sistema de decisão padrão para quem quer crescer no UGC do Fortnite com base em dados reais.”

---

## 15) Próxima fronteira natural

1. Benchmark mais robusto por painel/categoria/região.
2. Modelos de previsibilidade de permanência e migração entre painéis.
3. Recomendação tática orientada por contexto (sem “chute”).
4. Melhor explicabilidade de decisões para usuário final.

---

## 16) Fontes canônicas para manter este documento atualizado

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/DATABASE.md`
4. `docs/USAGE.md`
5. `docs/RALPH_*`
6. `docs/ralph/PRD_APP_VALUE_AND_DATA_SPECIALIST.md`
7. `supabase/migrations/*`
8. `supabase/functions/*`

Se houver conflito entre documento e implementação, prevalece:
1. migrations + edge functions (backend),
2. código de rotas/páginas (frontend).

