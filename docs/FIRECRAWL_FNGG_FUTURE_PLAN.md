# Plano Futuro: Integração Firecrawl + Fortnite.GG (Escopo Enxuto)

## 1) Objetivo
Usar Firecrawl apenas onde ele agrega valor direto, com custo baixo e sem duplicar dados que já vêm das APIs da Epic.

Este plano **não é para execução imediata**. É um documento de referência para implementação futura.

---

## 2) Decisão de Escopo (travada)

### 2.1 Coletas via Firecrawl
1. `https://fortnite.gg/player-count`
   - Frequência: **1x por dia**
   - Uso: **somente no report semanal** (contexto macro de mercado)
   - Não usar em monitoramento real-time.

2. `https://fortnite.gg/discover?banners`
   - Frequência: **a cada 30 minutos**
   - Uso: monitoramento de eventos/banner e enriquecimento de análises.

### 2.2 Coleta **não** via Firecrawl
1. `https://fortnite.gg/discover`
   - **Não usar Firecrawl** para discover.
   - Fonte oficial: continuar usando pipeline atual baseado nas APIs da Epic.
   - Motivo: evitar gasto de token em dado que já existe internamente.

---

## 3) Justificativa de Custo

Comparação de volume de chamadas:
1. Modelo antigo (3 páginas a cada 10 min): `432 chamadas/dia`
2. Modelo atual (banners 30min + player-count diário): `49 chamadas/dia`

Redução aproximada: **88.7%** de chamadas.

---

## 4) Arquitetura Alvo (futura)

## 4.1 Coletor Firecrawl
Script/worker dedicado com modos:
1. `mode=player-count`
2. `mode=banners`
3. `mode=all` (somente debug/manual)

Arquivo atual de base para evoluir:
1. `scripts/firecrawl_fngg_probe.mjs`

## 4.2 Ingestão no sistema
Futuro recomendado:
1. Edge function de ingestão (`fngg-ingest`) com token interno
2. Tabelas dedicadas para snapshots e eventos
3. Alertas no Command Center

Enquanto não houver ingestão:
1. manter saída local em `scripts/_out/firecrawl_fngg_probe/`

---

## 5) Dados a Persistir

## 5.1 Player Count (diário)
Campos mínimos:
1. `captured_at`
2. `players_now`
3. `peak_24h`
4. `all_time_peak`
5. `source_url`
6. `source = firecrawl_fngg`

Uso:
1. Report semanal (seção macro de ecossistema)
2. Comparativos semanais/mensais

## 5.2 Banners (30 min)
Campos mínimos:
1. `captured_at`
2. `map_title`
3. `event_title`
4. `start_at_utc`
5. `end_at_utc`
6. `banner_image_url`
7. `map_url` ou `link_code` quando disponível
8. `source_url`
9. `source = firecrawl_fngg`

Uso:
1. Timeline de banners/eventos
2. Evidência em report (eventos destacados)
3. Monitoramento interno de destaque editorial/promo

---

## 6) Política de Retenção (proposta)
1. Player-count diário: **365 dias**
2. Banners: **365 dias**
3. Runs/log técnico de coleta: **30 dias**
4. Raw HTML/markdown completo: **não persistir indefinidamente** (opcional 7 dias para debug)

---

## 7) Regras Operacionais

1. Se coleta falhar:
   - Registrar erro + `status=failed`
   - Não sobrescrever último valor válido

2. Se banners retornar vazio inesperado:
   - Marcar como `suspect`
   - Repetir 1 retry imediato

3. Se 3 falhas consecutivas:
   - Gerar alerta no Command Center (`warn/error`)

4. Sempre salvar metadados de execução:
   - duração
   - status HTTP
   - tamanho do payload (`markdown_len`, `html_len`)
   - versão do parser (`parser_version`)

---

## 8) Integração com Report

No report semanal, usar player-count diário como contexto:
1. média diária de `players_now` da semana
2. maior `peak_24h` da semana
3. tendência (alta/queda vs semana anterior)

No report semanal, usar banners:
1. total de banners no período
2. top mapas com mais aparições
3. eventos com maior janela de destaque

Importante:
1. Dados de Firecrawl entram como **fonte externa complementar**
2. Discover principal continua vindo da Epic pipeline

---

## 9) Checklist de Implementação Futura

1. Separar script em modos (`player-count`, `banners`, `all`)
2. Criar ingestão segura (`fngg-ingest`)
3. Criar tabelas e índices de snapshots/eventos
4. Criar cron:
   - player-count diário
   - banners a cada 30 min
5. Adicionar métricas no Command Center:
   - última coleta
   - sucesso 24h
   - erros consecutivos
6. Conectar blocos no report semanal

---

## 10) Critério de Aceite

1. Coleta de banners estável por 24h (>= 95% sucesso)
2. Coleta diária de player-count sem falha por 7 dias
3. Dados aparecem no report semanal sem impactar pipeline Epic
4. Custo mensal de créditos Firecrawl dentro do orçamento definido

---

## 11) Fora de Escopo (neste plano)

1. Usar Firecrawl para `discover` completo
2. Substituir pipeline Epic por dados de scraping
3. Publicação pública em tempo real de player-count por Firecrawl

