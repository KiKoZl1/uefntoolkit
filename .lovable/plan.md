# Correcao de Bugs e Melhorias do Discover Trends

## Bugs Identificados

### Bug 1: Avg D1 e Avg D7 mostrando "---"

**Causa raiz:** O coletor salva os KPIs como `platformAvgD1` e `platformAvgD7`, mas o frontend tenta ler `kpis.avgRetentionD1` e `kpis.avgRetentionD7`. Os nomes nao batem.

**Correcao:** Alinhar os nomes no coletor para `avgRetentionD1`/`avgRetentionD7`, ou ajustar o frontend para usar `platformAvgD1`/`platformAvgD7`.

### Bug 2: Botao de Excluir nao funciona

**Causa raiz:** A tabela `discover_reports` nao tem politica RLS para DELETE. O banco bloqueia silenciosamente a operacao.

**Correcao:** Criar uma migracao SQL adicionando politica DELETE para usuarios autenticados na tabela `discover_reports`.

---

## Melhorias Solicitadas

### 1. Aumentar captura para 10.000 ilhas

Alterar `TARGET_ISLANDS` de 3000 para 10000 no frontend. O coletor ja suporta multi-pass, entao vai simplesmente fazer mais lotes.

### 2. Novas metricas e rankings no coletor

Adicionar ao `computeReportData()`:

- **Trend Detection (nomes similares):** Agrupar ilhas por palavras-chave no titulo (ex: "Squid Game", "Zombie", "1v1") e rankear as trends emergentes por volume de plays/players.
- **Ilhas novas da semana:** Filtrar ilhas que apareceram pela primeira vez nesta coleta (comparando com `discover_islands` existentes no banco).
- **Ilhas com melhor performance entre as novas:** Top 10 novas ilhas por plays, CCU, retention.
- **Ilhas com falha:** Ilhas com menos de 500 jogadores unicos, poucas tags, baixo engajamento.
- **Criadores novos:** Criadores que nao existiam em coletas anteriores.
- **Total de novos mapas esta semana.**
- **Media de mapas por criador esta semana.**
- **Top Maps com maior crescimento semanal.**

### 3. Novos KPIs na plataforma

Adicionar ao `platformKPIs`:

- `newMapsThisWeek`
- `newCreatorsThisWeek`
- `avgMapsPerCreatorThisWeek`
- `failedIslands` (ilhas com < 500 players)
- `avgRetentionD1` / `avgRetentionD7` (corrigir nome)

### 4. Novas secoes/rankings no frontend (DiscoverTrendsReport)

- Secao de "Trending Topics" mostrando agrupamentos por palavras-chave
- Secao de "Novas Ilhas da Semana" com top performers
- Secao de "Ilhas com Baixa Performance"
- KPIs de novos mapas e novos criadores na Secao 1

### 5. Melhorar narrativas da IA

Reformular o prompt do `discover-report-ai` para:

- Gerar narrativas mais longas (4-6 frases por secao)
- Incluir insights acionaveis concretos para criadores
- Comparar com benchmarks do ecossistema
- Mencionar trends emergentes detectadas
- Dar mais contexto sobre as novas ilhas da semana
- Enviar mais dados (aumentar o slice de 4000 para 8000+ chars)

---

## Detalhes Tecnicos

### Migracao SQL

```text
-- Permitir DELETE em discover_reports para usuarios autenticados
CREATE POLICY "Authenticated users can delete discover reports"
  ON public.discover_reports FOR DELETE
  USING (auth.uid() IS NOT NULL);
```

### Arquivos modificados

1. **Migracao SQL** - Adicionar politica DELETE em `discover_reports`
2. `**supabase/functions/discover-collector/index.ts**`
  - Corrigir nomes dos KPIs de retention (`platformAvgD1` -> `avgRetentionD1`)
  - Adicionar deteccao de trends por palavras-chave no titulo
  - Adicionar identificacao de ilhas novas (comparando com banco)
  - Adicionar contagem de criadores novos
  - Adicionar ranking de ilhas com falha
  - Adicionar ranking de top novas ilhas
  - Adicionar ranking de growth semanal
3. `**src/pages/DiscoverTrendsList.tsx**`
  - Mudar `TARGET_ISLANDS` para 10000
4. `**src/pages/DiscoverTrendsReport.tsx**`
  - Corrigir leitura dos KPIs D1/D7
  - Adicionar novas secoes: Trending Topics, Novas Ilhas, Ilhas com Falha
  - Adicionar KPIs de novos mapas/criadores na Secao 1
5. `**supabase/functions/discover-report-ai/index.ts**`
  - Reformular prompt para narrativas mais ricas e detalhadas
  - Enviar mais dados ao modelo (rankings + novos dados de trends)

### Ordem de execucao

1. Migracao SQL (fix delete)
2. Coletor (fix retention names + novas metricas)
3. Frontend report (fix KPI names + novas secoes)
4. Frontend list (target 10K)
5. AI narratives (prompt melhorado)