

# Discover Trends -- Relatorios Semanais Automaticos do Ecossistema Fortnite

## Resumo

Criar uma nova ferramenta **Discover Trends** integrada a plataforma, que gera relatorios semanais automaticos sobre o ecossistema inteiro do Fortnite Discovery usando a API publica da Epic Games. O usuario entra na pagina, ve os ultimos 4 relatorios, escolhe um, e navega por secoes visuais ricas (graficos, rankings, infograficos) -- similar ao PDF de referencia. Tambem pode pesquisar uma ilha especifica por codigo para analise detalhada.

---

## Como vai funcionar

1. **Coleta automatica**: Uma Edge Function (`discover-collector`) e acionada via cron toda segunda-feira. Ela busca dados das top ~500 ilhas da API publica da Epic (`api.fortnite.com/ecosystem/v1`), calcula rankings e metricas derivadas, e salva no banco.

2. **Analise por IA**: Uma segunda Edge Function (`discover-report-ai`) gera narrativas para cada secao do relatorio usando Lovable AI (Gemini), baseada nos dados coletados.

3. **Visualizacao**: O usuario acessa `/app/discover-trends`, ve os ultimos 4 relatorios como cards, clica em um, e entra em uma pagina de scroll continuo com 8 secoes visuais (graficos de barras, rankings, KPIs com variacao %, pie charts de categorias, e narrativa IA ao lado de cada grafico).

4. **Pesquisa de ilha**: No painel, o usuario pode digitar um codigo de ilha (ex: `1234-5678-9012`) e o sistema busca os dados da API em tempo real, gerando uma pagina de analytics daquela ilha especifica -- complementando os dados de CSV.

5. **Modo teste**: Alem do cron semanal, havera um botao admin para gerar relatorio sob demanda (para testes).

---

## Secoes do Relatorio (8 secoes visuais, inspiradas no PDF)

Cada secao tera: KPI cards com variacao % vs semana anterior, graficos (barras horizontais, pie, timeseries), tabelas de ranking top 10, e texto narrativo da IA ao lado.

### 1. Core Activity Metrics
- KPIs: Total Creators, New Creators, Active Maps, Inactive Maps, New Maps, Avg Maps/Creator
- Graficos: Barras de ativos vs inativos, tendencia semanal

### 2. Player Engagement Metrics
- KPIs: Avg Players/Day, Total Plays, Avg CCU/Map, Avg Play Duration, Total Minutes
- Rankings: Top 10 Peak CCU (Global), Top 10 Peak CCU (UGC), Top 10 Avg Peak CCU
- Graficos: Barras horizontais para cada ranking

### 3. Retention & Loyalty Metrics
- KPIs: Platform Avg D1, Avg D7, Fav-to-Play Ratio, Recommend-to-Play Ratio
- Rankings: Top 10 D1 Maps, Top 10 D7 Maps, Top 10 D1 UGC, Top 10 D7 UGC
- Graficos: Barras com % de retencao

### 4. Creator Performance Metrics
- Rankings: Top 10 Creators por Total Plays, Unique Players, Minutes, Peak CCU, D1, D7
- Graficos: Barras horizontais por criador

### 5. Map-Level Quality Metrics
- Rankings: Top 10 Avg Minutes/Player, Top Favorites, Top Recommendations, Highest Weekly Growth
- Rankings: Top 10 D1/D7 Stickiest Maps (Global e UGC)

### 6. Ratios & Derived Metrics
- Rankings: Plays/Unique Player, Minutes/Favorite, Favorites/100 Players, Recommendations/100 Players
- Retention-Adjusted Engagement (avgMinutes x D1 e D7)

### 7. Category & Tag Analytics
- Pie chart: Category Popularity Share
- Rankings: Avg Plays/Category, Avg CCU/Category
- Top Tags trending

### 8. Efficiency / Conversion Metrics
- Rankings: Favorites/Play, Recommends/Play, Minutes/Play eficiencia

---

## Pesquisa de Ilha Individual

O usuario digita o codigo da ilha e ve:
- Metadados (titulo, criador, tags, categoria)
- Metricas dos ultimos 7 dias: unique players, plays, minutes played, peak CCU, avg minutes/player, favorites, recommendations, D1, D7
- Graficos timeseries (dia a dia) para cada metrica
- Comparacao com medias da plataforma (dos dados do relatorio semanal)
- Complementa os dados do CSV upload quando a ilha ja tem um projeto

---

## Detalhes Tecnicos

### Novas Tabelas no Banco

**`discover_reports`**
- `id` (uuid PK)
- `week_start` (date)
- `week_end` (date)
- `week_number` (int)
- `year` (int)
- `status` (text: 'collecting' | 'analyzing' | 'completed' | 'error')
- `raw_metrics` (jsonb) -- dados agregados das ilhas
- `computed_rankings` (jsonb) -- rankings top 10 por secao
- `platform_kpis` (jsonb) -- KPIs da plataforma
- `ai_narratives` (jsonb) -- texto IA por secao
- `island_count` (int)
- `created_at`, `updated_at`

RLS: SELECT para usuarios autenticados (dados publicos). INSERT/UPDATE somente via service_role (edge function).

**`discover_islands`** (cache de metadados)
- `id` (uuid PK)
- `island_code` (text, unique index)
- `title`, `creator_code`, `category`, `tags` (jsonb), `created_in`
- `last_metrics` (jsonb) -- ultima coleta de metricas
- `updated_at`

RLS: SELECT para autenticados.

### Novas Edge Functions

**`discover-collector`** (complexa, ~300 linhas)
- Busca `/islands` paginado (ate 1000 ilhas)
- Para cada ilha busca `/islands/{code}/metrics/day` com from/to dos ultimos 7 dias
- Calcula: rankings top 10 para cada secao, KPIs da plataforma, ratios derivados
- Agrupa por criador para Creator Performance
- Agrupa por categoria para Category Analytics
- Salva em `discover_reports` e atualiza `discover_islands`
- Rate limiting: delay entre requests, retry no 429

**`discover-report-ai`**
- Recebe `report_id`
- Carrega `computed_rankings` e `platform_kpis`
- Envia para Lovable AI com prompt especializado
- Gera narrativa para cada uma das 8 secoes
- Salva em `ai_narratives`

**`discover-island-lookup`**
- Recebe `island_code`
- Busca metadados + metricas diarias da API da Epic em tempo real
- Retorna dados formatados para o frontend

### Cron Job (coleta automatica)
- `pg_cron` + `pg_net` para chamar `discover-collector` toda segunda 06:00 UTC
- SQL via insert tool (nao migration)

### Novas Paginas

**`/app/discover-trends`** -- Lista de relatorios
- Cards dos ultimos 4 relatorios com preview de KPIs
- Status badges (coletando / analisando / pronto)
- Botao "Gerar Report" (admin/teste)

**`/app/discover-trends/:reportId`** -- Report completo
- Pagina de scroll continuo (nao tabs)
- 8 secoes com separadores visuais (titulo grande + icone, como no PDF)
- Cada secao: KPI cards em grid, graficos Recharts, tabelas de ranking, texto IA em destaque
- Variacao % vs semana anterior (verde/vermelho com setas)

**`/app/island-lookup`** -- Pesquisa de ilha
- Input para codigo da ilha
- Dashboard de metricas com graficos timeseries
- Comparacao com medias da plataforma

### Reestruturacao da Navegacao

- `/app` vira layout com sidebar (Island Analytics, Discover Trends, Pesquisar Ilha)
- Landing page atualizada com as 3 ferramentas
- Rotas existentes de Island Analytics movidas para sub-rotas

---

## Sequencia de Implementacao

### Etapa 1: Banco de Dados
Criar tabelas `discover_reports` e `discover_islands` com RLS adequado. Habilitar `pg_cron` e `pg_net`.

### Etapa 2: Edge Function `discover-collector`
Implementar coleta paginada, calculo de rankings e KPIs, salvamento no banco.

### Etapa 3: Edge Function `discover-report-ai`
Gerar narrativas por secao via Lovable AI.

### Etapa 4: Edge Function `discover-island-lookup`
Busca de ilha individual em tempo real.

### Etapa 5: Frontend -- Novas Paginas
- Pagina de lista de relatorios
- Pagina de report com scroll e 8 secoes visuais
- Pagina de pesquisa de ilha

### Etapa 6: Reestruturacao
- Sidebar de navegacao no `/app`
- Landing page atualizada
- Cron job configurado

### Etapa 7: Polish
- Loading states com skeleton
- Empty states
- Responsividade
- Variacao % com cores e setas

