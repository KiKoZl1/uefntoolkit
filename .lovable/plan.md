
# Correcao de Bugs e Enriquecimento Visual do Relatorio

## Problemas Identificados

### 1. Categorias Duplicadas (Walking Dead / Rocket Racing)
A tabela `discover_report_islands` armazena categorias com casing inconsistente:
- "Rocket Racing" vs "ROCKET RACING"
- "The Walking Dead Universe" vs "THE WALKING DEAD UNIVERSE"

O RPC `report_finalize_categories` agrupa por `category` sem normalizar o casing, resultando em entradas duplicadas nos rankings e no grafico de pizza.

**Correcao**: Atualizar o RPC para usar `UPPER()` ou `INITCAP()` na agregacao, unificando as variantes.

### 2. "Most Updated" nao mostra numero de atualizacoes
O RPC `report_most_updated_islands` filtra ilhas cuja `updated_at_epic` caiu na semana, mas nao retorna o campo `version` (numero de versoes/iteracoes). O resultado e um ranking por plays, sem indicar quantas vezes a ilha foi atualizada.

**Correcao**: Alterar o RPC para incluir `lm.version` no SELECT e no resultado. No frontend, exibir o numero de versao como subtitle (ex: "v14 - @Creator").

### 3. Epic misturada com UGC
Ilhas da Epic (creator_code = 'Epic', 'Epic Labs', etc.) aparecem nos mesmos rankings que UGC. Isso distorce metricas reais dos criadores independentes.

**Correcao**: 
- Criar filtro `is_epic_creator` baseado em lista conhecida: `['epic', 'epic labs', 'epic games']`
- Na secao "Most Updated", separar em dois rankings: "Epic First-Party" e "UGC Creators"
- Nos rankings de criadores, adicionar badge indicando Epic vs UGC

### 4. Multi-Panel Presence e Panel Loyalty vazios
O RPC `report_finalize_exposure_analysis` consulta `discovery_exposure_rollup_daily` com datas da semana (Feb 7-14), mas os dados de rollup so existem a partir de Feb 14-15. Resultado: 0 registros encontrados.

**Correcao**: Ampliar a janela de busca no RPC para `p_days` dias antes da `week_end` (nao depender de `week_start`). Alternativamente, usar `discovery_exposure_presence_segments` diretamente (que tem dados mais completos) em vez do rollup.

### 5. Thumbnails e melhorias visuais nao implementadas
O componente `RankingTable` nao possui prop `imageUrl` nem renderiza imagens. As melhorias visuais planejadas (badges ouro/prata/bronze, glassmorphism, gradientes) nao foram aplicadas.

---

## Plano de Implementacao

### Fase 1: SQL - Corrigir RPCs (Migration)

**1a. Corrigir duplicatas de categoria**
Atualizar `report_finalize_categories` para normalizar casing com `INITCAP(LOWER(category))`, unificando "ROCKET RACING" e "Rocket Racing" como "Rocket Racing".

**1b. Enriquecer "Most Updated" com version**
Atualizar `report_most_updated_islands` para incluir `lm.version` no resultado.

**1c. Corrigir Exposure Analysis**
Atualizar `report_finalize_exposure_analysis` para usar `discovery_exposure_presence_segments` (que tem ~83k registros) em vez de `discovery_exposure_rollup_daily` (que pode nao ter dados na janela da semana).

### Fase 2: Frontend - Separacao Epic vs UGC

**2a. Atualizar RankingTable com thumbnails e badges**
- Adicionar props opcionais: `showImage?: boolean`, `showBadges?: boolean`
- Renderizar `image_url` como thumbnail 32x32 ao lado do nome
- Mostrar badge dourado/prata/bronze para top 3

**2b. Separar Epic vs UGC nas secoes relevantes**
- Na secao 22 (Most Updated), renderizar dois rankings separados
- Na secao 7 (Creators), filtrar Epic do ranking UGC
- Definir lista de creator codes Epic no frontend: `['epic', 'epic labs', 'epic games']`

**2c. Exibir version count no "Most Updated"**
- Mostrar subtitle como "v{version} - @{creator}" em vez de apenas "@creator"

### Fase 3: Visual Polish

**3a. Section headers com gradiente**
Adicionar gradient sutil no `SectionHeader` baseado na cor do icone da secao.

**3b. Badges de destaque**
Implementar badges visuais (emoji ou SVG) para posicoes 1-3: ouro, prata, bronze.

**3c. Glassmorphism nos cards**
Aplicar `backdrop-blur` e `bg-white/5` nos Cards para efeito de profundidade.

---

## Detalhes Tecnicos

### Migration SQL

```text
-- 1. report_finalize_categories: normalizar casing
-- Substituir GROUP BY category por GROUP BY INITCAP(LOWER(category))

-- 2. report_most_updated_islands: adicionar version  
-- Adicionar lm.version ao SELECT e retorno

-- 3. report_finalize_exposure_analysis: usar segments
-- Trocar discovery_exposure_rollup_daily por 
-- discovery_exposure_presence_segments com calculo
-- de EXTRACT(EPOCH FROM (last_seen_ts - start_ts))/60
```

### RankingTable Enhanced

```text
interface RankingItem {
  name: string;
  code?: string;
  value: number;
  label?: string;
  subtitle?: string;
  imageUrl?: string;  // NOVO
}

interface RankingTableProps {
  // ... existentes
  showImage?: boolean;   // NOVO
  showBadges?: boolean;  // NOVO
}
```

### Epic Creator Filter

```text
const EPIC_CREATORS = new Set([
  'epic', 'epic labs', 'epic games', 'fortnite'
]);

function isEpicCreator(creator: string): boolean {
  return EPIC_CREATORS.has(creator?.toLowerCase?.() || '');
}
```

### Arquivos a Modificar

1. `supabase/migrations/` - Nova migration para corrigir 3 RPCs
2. `src/components/discover/RankingTable.tsx` - Thumbnails + badges
3. `src/components/discover/SectionHeader.tsx` - Gradientes
4. `src/pages/public/ReportView.tsx` - Separacao Epic/UGC, version display
5. `supabase/functions/discover-report-rebuild/index.ts` - Passar image_url/version nos items montados
