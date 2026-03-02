# Plano de Caption para Treino de LoRA
## TGIS — Thumbnail Generation Intelligence System

**Data:** 2026-02-28
**Status:** Aprovado para Implementação

---

## 1. Por que caption importa

Um LoRA treinado só com imagens aprende o estilo visual mas não aprende contexto. Sem caption, todos os sub-estilos dentro de uma categoria viram uma média genérica:

```
Treino sem caption:
  imagem: [thumb de box fight]    → prompt: "combat thumbnail"
  imagem: [thumb de red vs blue]  → prompt: "combat thumbnail"
  imagem: [thumb de gun game]     → prompt: "combat thumbnail"

Resultado: o LoRA aprende "combat genérico".
Pede "box fight thumbnail" — ele não sabe o que é.
```

```
Treino com caption rico:
  imagem: [thumb de box fight]    → prompt: "combat thumbnail, box fight, 1v1, arena fechada, sem construção"
  imagem: [thumb de red vs blue]  → prompt: "combat thumbnail, red vs blue, duas equipes, cores contrastantes"
  imagem: [thumb de gun game]     → prompt: "combat thumbnail, gun game, progressão de armas, eliminação"

Resultado: o LoRA aprende sub-estilos reais.
Pede "box fight thumbnail" — ele entrega.
```

---

## 2. Fontes de dados disponíveis (sem custo de API)

Todos os dados já existem no banco. O join principal é entre `discover_link_metadata` e `discover_report_islands`.

A view `tgis_island_metadata_latest` centraliza tudo:

```sql
CREATE VIEW tgis_island_metadata_latest AS
SELECT 
    dlm.link_code,
    dlm.image_url,
    dlm.tagline         AS description,
    dlm.introduction,
    dlm.published_at_epic,
    dlm.updated_at_epic,
    dlm.version,
    dlm.max_players,
    dri.title,
    dri.tags,
    dri.created_in      AS map_type
FROM discover_link_metadata dlm
LEFT JOIN (
    SELECT DISTINCT ON (island_code) *
    FROM discover_report_islands
    ORDER BY island_code, snapshot_date DESC
) dri ON dri.island_code = dlm.link_code
```

**Nota:** `CREATE VIEW` não duplica dados. É uma query salva — zero storage adicional, zero cópia de dados. Os dados continuam nas tabelas originais.

Por ilha, o pipeline tem acesso a:

| Campo | Fonte | Exemplo |
|---|---|---|
| `title` | discover_report_islands | "FRUITS VS BRAINROTS" |
| `tags` | discover_report_islands | ["tycoon", "casual", "simulator"] |
| `description` | discover_link_metadata.tagline | "🍉 Buy seeds & plant fruits..." |
| `introduction` | discover_link_metadata.introduction | "🌱 Buy seeds & plant it..." |
| `cluster` | visual_clusters | "tycoon" |
| `image_url` | discover_link_metadata | "https://..." |

---

## 3. Pipeline de geração de caption

### 3.1 Visão geral

```
tgis_island_metadata_latest (view)
           +
visual_clusters.csv (cluster por ilha)
           ↓
caption_builder.py
           ↓
training_metadata.csv
  → link_code, image_url, cluster, caption
```

### 3.2 Limpeza dos dados brutos

Descrição e introduction chegam com emojis, frases longas e repetição. Precisam de limpeza antes de entrar no caption:

```python
import re
import spacy

nlp = spacy.load("pt_core_news_sm")  # ou en_core_web_sm para inglês

def clean_text(text: str) -> str:
    if not text:
        return ""
    # Remove emojis e caracteres especiais
    text = re.sub(r'[^\w\s,!?]', ' ', text)
    # Remove espaços múltiplos
    text = re.sub(r'\s+', ' ', text).strip()
    return text.lower()

def extract_keywords(text: str, max_keywords: int = 8) -> list[str]:
    """Extrai palavras-chave relevantes da descrição."""
    cleaned = clean_text(text)
    doc = nlp(cleaned)
    
    # Pega substantivos e verbos principais
    keywords = []
    for token in doc:
        if token.pos_ in ("NOUN", "VERB") and not token.is_stop:
            if len(token.text) > 3:  # ignora palavras muito curtas
                keywords.append(token.lemma_)
    
    # Remove duplicatas mantendo ordem
    seen = set()
    unique = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            unique.append(kw)
    
    return unique[:max_keywords]

def clean_title(title: str) -> str:
    """Limpa o título da ilha para usar no caption."""
    if not title:
        return ""
    # Remove caps desnecessário, mantém legível
    cleaned = clean_text(title)
    # Ignora títulos genéricos que não agregam
    generic = {"island", "map", "v2", "v3", "update", "new", "mode"}
    words = [w for w in cleaned.split() if w not in generic]
    return " ".join(words) if len(" ".join(words)) > 4 else ""

def clean_tags(tags: list) -> list[str]:
    """Limpa e normaliza tags."""
    if not tags:
        return []
    cleaned = []
    for tag in tags:
        tag = tag.lower().strip().replace("-", " ").replace("_", " ")
        if len(tag) > 2:
            cleaned.append(tag)
    return cleaned
```

### 3.3 Montagem do caption

```python
def build_caption(
    cluster: str,
    title: str,
    tags: list,
    description: str,
    introduction: str,
    max_length: int = 120
) -> str:
    parts = []
    
    # 1. Categoria sempre primeiro (âncora do caption)
    parts.append(f"{cluster} thumbnail")
    
    # 2. Tags limpas (máximo 5)
    clean = clean_tags(tags)
    parts.extend(clean[:5])
    
    # 3. Keywords da descrição + introduction combinadas
    combined_text = f"{description} {introduction}"
    keywords = extract_keywords(combined_text, max_keywords=8)
    parts.extend(keywords)
    
    # 4. Título limpo (se for descritivo)
    title_clean = clean_title(title)
    if title_clean:
        parts.append(title_clean)
    
    # 5. Deduplica mantendo ordem
    seen = set()
    final = []
    for part in parts:
        if part not in seen:
            seen.add(part)
            final.append(part)
    
    caption = ", ".join(final)
    
    # Trunca se necessário
    if len(caption) > max_length:
        caption = caption[:max_length].rsplit(",", 1)[0]
    
    return caption
```

### 3.4 Exemplo real de output

**Ilha:** FRUITS VS BRAINROTS (4554-4413-1515)

```
Inputs:
  cluster:     "tycoon"
  title:       "FRUITS VS BRAINROTS"
  tags:        ["tycoon", "casual", "simulator", "just for fun"]
  description: "🍉 Buy seeds & plant fruits in your garden! Fight alongside 
                your fruits against the brainrots! Earn money and grow offline!"
  introduction:"🌱 Buy seeds & plant it in your garden! Fight alongside 
                your plants! Earn money and grow offline!"

Output:
  "tycoon thumbnail, casual, simulator, buy, plant, garden, 
   fight, earn money, offline, fruits vs brainrots"
```

vs caption sem descrição (antes):
```
  "tycoon thumbnail, tycoon, casual, simulator, just for fun"
```

---

## 4. Query de exportação

```sql
SELECT 
    vc.link_code,
    vc.image_url,
    vc.cluster,
    m.title,
    m.tags,
    m.description,
    m.introduction
FROM visual_clusters vc
JOIN tgis_island_metadata_latest m ON vc.link_code = m.link_code
WHERE vc.cluster != 'misc'
ORDER BY vc.cluster, vc.link_code
```

Retorna: **17.221 linhas** (21.823 total - 4.602 misc)

---

## 5. Output do pipeline

### Arquivo 1: `training_metadata.csv`

```
link_code, image_url, cluster, caption
4554-4413-1515, https://..., tycoon, "tycoon thumbnail, casual, simulator, garden, farming, fight, earn money, offline, fruits vs brainrots"
4087-0498-1913, https://..., combat, "combat thumbnail, pvp, red vs blue, teams, arena, two teams, red vs blue ultimate"
...
```

17.221 linhas — uma por thumb classificada, excluindo misc.

### Arquivo 2: `training_metadata_report.json`

```json
{
  "total_rows": 17221,
  "by_cluster": {
    "combat": 6297,
    "horror": 3005,
    "driving": 2791,
    "deathrun": 1573,
    "tycoon": 1421,
    "party_games": 1026,
    "roleplay": 416,
    "prop_hunt": 363,
    "fashion": 329
  },
  "caption_coverage": {
    "has_tags": 0,
    "has_description": 0,
    "has_introduction": 0,
    "has_title_only": 0
  },
  "examples_by_cluster": {
    "combat": ["combat thumbnail, pvp, red vs blue..."],
    "tycoon": ["tycoon thumbnail, casual, simulator..."]
  }
}
```

---

## 6. Estratégia de treino dos LoRAs

### 6.1 Estrutura de dataset por LoRA

```
dataset/
├── combat/
│   ├── images/          ← 6.297 thumbs baixadas
│   └── metadata.jsonl   ← caption por imagem
├── horror/
│   ├── images/
│   └── metadata.jsonl
├── driving/
...
```

Formato do `metadata.jsonl` (um objeto JSON por linha):

```json
{"file_name": "4087-0498-1913.jpg", "text": "combat thumbnail, red vs blue, pvp, teams, arena"}
{"file_name": "4074-5350-1257.jpg", "text": "combat thumbnail, box fight, 1v1, arena fechada"}
```

### 6.2 Dois pools, dois momentos de treino

**Treino base (roda uma vez ou trimestralmente):**

```
Dataset: Pool A + B (21.823 thumbs → 17.221 classificadas)
Caption: gerado pelo caption_builder.py
Objetivo: aprender o dialeto visual Fortnite por categoria
Resultado: 10 LoRAs base — um por categoria
```

**Reforço mensal (roda todo mês):**

```
Dataset: Pool C (top performers, score >= 0.25, últimos 30 dias)
Caption: mesmo pipeline de caption
Objetivo: calibrar "o que converte" dentro do estilo aprendido
Resultado: fine-tune dos 10 LoRAs com sinal de performance
Regra: não substitui o base — é incremento controlado por versão
```

### 6.3 Versionamento dos LoRAs

```
lora_combat_v1_base      ← treino inicial com A+B
lora_combat_v1_r1        ← reforço mês 1 (Pool C jan/2026)
lora_combat_v1_r2        ← reforço mês 2 (Pool C fev/2026)
lora_combat_v2_base      ← retrain completo quando dataset crescer muito
```

Nunca sobrescrever a versão anterior — sempre incrementar. Permite rollback se o reforço degradar a qualidade.

---

## 7. Upgrade futuro — GPT-4 Vision

O pipeline atual gera captions ricos de graça usando dados do banco. O GPT-4 Vision é um upgrade opcional para quando o LoRA já estiver treinado e você identificar limitações específicas.

**Quando faz sentido:**

Após o primeiro ciclo de treino, se o output do LoRA mostrar que ele não está capturando elementos visuais que as tags não descrevem (composição, iluminação, estilo artístico, cores específicas).

**Custo estimado quando for o momento:**

| Escopo | Custo estimado |
|---|---|
| Só Pool C (6.175 thumbs) | ~$30-35 |
| Dataset completo (17.221 thumbs) | ~$85-90 |

**Estratégia recomendada quando for usar:**

Rodar primeiro em 50-100 thumbs para validar a qualidade dos captions antes de escalar. Se os captions gerados forem ricos e específicos — escala. Se forem genéricos — ajusta o prompt do Vision antes de gastar o valor cheio.

O campo `caption` no `training_metadata.csv` é substituído pelo caption enriquecido — nenhuma outra mudança no pipeline.

---

## 8. Resumo do que implementar

### Passo 1 — View no banco
```sql
CREATE VIEW tgis_island_metadata_latest AS [query da seção 2]
```

### Passo 2 — caption_builder.py
- Função `clean_text()`
- Função `extract_keywords()` com spaCy
- Função `clean_tags()`
- Função `clean_title()`
- Função `build_caption()` montando tudo

### Passo 3 — Export
- Query da seção 4 joinando `visual_clusters` + `tgis_island_metadata_latest`
- Roda `build_caption()` para cada linha
- Salva `training_metadata.csv` e `training_metadata_report.json`

### Passo 4 — Validação manual
- Abre o report e revisa 10 exemplos por categoria
- Confirma que captions estão descritivos e sem lixo de emoji/caracteres especiais

### Passo 5 — Dataset final pronto para treino
- `training_metadata.csv` com 17.221 linhas
- Cada linha: `link_code, image_url, cluster, caption`
- Pronto para o pipeline de download de imagens e treino dos 10 LoRAs

---

*TGIS Caption Pipeline — 2026-02-28 — Epic Insight Engine — Confidencial*
