# TGIS — Nova Arquitetura: Nano Banana 2

**Data:** 2026-03-03  
**Decisão:** Migração completa de Flux LoRA → Nano Banana 2 (Gemini 3.1 Flash Image)  
**Motivo:** Nano Banana 2 suporta até 14 imagens de referência simultâneas, permitindo que o usuário escolha seus próprios skins Fortnite e eles apareçam fielmente na thumbnail gerada. Isso é impossível com LoRA.

---

## 1. MODELO DE GERAÇÃO

**Endpoint:** `fal-ai/nano-banana-2/edit`  
**Custo por geração:** $0.12 base (resolução 2K) + $0.015 web search = **$0.135 total**  
**Resolução:** 1920x1080 (2K obrigatório — padrão Fortnite Creative)  
**Variações por request:** 1 (usuário regenera se quiser)  
**Web search:** ligado por padrão

---

## 2. API — NANO BANANA 2

**Endpoint:** `fal-ai/nano-banana-2/edit`  
**Client:** `@fal-ai/client` (npm)  
**Auth:** variável de ambiente `FAL_KEY`

### 2.1 Input Schema

| Campo | Tipo | Obrigatório | Default | Descrição |
|-------|------|-------------|---------|-----------|
| `prompt` | string | ✅ | — | Prompt de geração construído pelo template engine |
| `image_urls` | list\<string\> | ✅ | — | URLs das imagens de referência (skins + refs do cluster). Máximo 14 |
| `resolution` | enum | ❌ | `1K` | **Usar `2K`** para gerar 1920x1080 |
| `aspect_ratio` | enum | ❌ | `auto` | **Usar `16:9`** para thumbs Fortnite |
| `enable_web_search` | boolean | ❌ | — | Contexto Externo — `true` por padrão no TGIS |
| `num_images` | integer | ❌ | `1` | Sempre `1` no TGIS |
| `output_format` | enum | ❌ | `png` | Manter `png` |
| `safety_tolerance` | enum | ❌ | `4` | Manter default |
| `limit_generations` | boolean | ❌ | `true` | Manter `true` — garante 1 imagem por request |
| `seed` | integer | ❌ | — | Opcional — passar seed fixo permite reproduzir resultado |

### 2.2 Output Schema

```json
{
  "images": [
    {
      "url": "https://storage.googleapis.com/falserverless/...",
      "content_type": "image/png",
      "file_name": "output.png",
      "file_size": 123456,
      "width": 1920,
      "height": 1080
    }
  ],
  "description": ""
}
```

O campo relevante é `images[0].url` — é a URL da thumb gerada que vai para o histórico e para o frontend.

### 2.3 Exemplo de request completo (TypeScript)

```typescript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/nano-banana-2/edit", {
  input: {
    prompt: buildPrompt(formData),        // template engine monta o prompt
    image_urls: buildImageUrls(formData), // slots dinâmicos: skins + ref usuário + cluster refs
    resolution: "2K",
    aspect_ratio: "16:9",
    num_images: 1,
    output_format: "png",
    limit_generations: true,
    enable_web_search: formData.contextoExterno, // toggle do usuário, default true
  },
  logs: false,
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      // atualizar estado de loading no frontend
    }
  },
});

const imageUrl = result.data.images[0].url;
// salvar no histórico + exibir no frontend
```

### 2.4 Montagem do array image_urls (slots dinâmicos)

```typescript
function buildImageUrls(formData: FormData): string[] {
  const urls: string[] = [];

  // Slots de skin (0, 1 ou 2)
  if (formData.skin1?.image_url) urls.push(formData.skin1.image_url);
  if (formData.skin2?.image_url) urls.push(formData.skin2.image_url);

  // Slot de referência do usuário (0 ou 1)
  if (formData.referenceImageUrl) urls.push(formData.referenceImageUrl);

  // Slots restantes: top thumbs do cluster por quality_score
  const remainingSlots = 14 - urls.length;
  const clusterRefs = getTopClusterRefs(formData.clusterVencedor, remainingSlots);
  urls.push(...clusterRefs);

  return urls;
}
```

### 2.5 Custo por geração

| Configuração | Custo |
|---|---|
| Base (2K, sem web search) | $0.12 |
| Com `enable_web_search: true` | $0.12 + $0.015 = **$0.135** |

---

## 3. CAMPOS DO FORMULÁRIO

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| Tags do mapa | ✅ | Multi-select. Alimenta o algoritmo de cluster e mood automático |
| Título do mapa | ❌ | Texto livre. Usado APENAS na construção do prompt — nunca aparece na imagem gerada |
| Descrição da thumbnail | ✅ | O usuário descreve o que quer ver na imagem em linguagem natural |
| Ângulo de câmera | ✅ | Enum: Low Angle / Eye Level / High Angle / Dutch Angle Dinâmico |
| Mood | ❌ | Derivado automaticamente da tag principal. Usuário pode sobrescrever. Exemplos: Intense, Epic, Fun, Scary, Chill |
| Skin 1 | ❌ | Seletor visual com imagens. Busca por nome ou ID via fortnite-api.com |
| Skin 2 | ❌ | Idem Skin 1 |
| Imagem de referência | ❌ | Upload livre. Thumb que o usuário usa como inspiração visual |
| Contexto Externo | toggle | Web search do Nano Banana. On por padrão. Exibido como feature premium no UI |

---

## 4. SISTEMA DE SLOTS DINÂMICOS

Total de slots disponíveis no Nano Banana 2: **14**

A distribuição é dinâmica baseada no que o usuário preencheu:

```
slots_skin      = 0, 1 ou 2   (dependendo de quantos skins foram selecionados)
slots_ref       = 0 ou 1       (dependendo se enviou imagem de referência)
slots_cluster   = 14 - slots_skin - slots_ref  (sempre maximiza refs do cluster)
```

**Exemplos:**
- Sem skin, sem ref → 14 thumbs do cluster
- 1 skin, sem ref → 1 skin + 13 thumbs do cluster
- 2 skins, sem ref → 2 skins + 12 thumbs do cluster
- 2 skins + ref → 2 skins + 1 ref + 11 thumbs do cluster

---

## 4. ALGORITMO DE SELEÇÃO DO CLUSTER

### 4.1 Mapeamento de tags por cluster

Cada tag tem um peso por cluster. O cluster que acumular maior peso total vence e fornece as refs.

O mapeamento deve ser construído a partir do `clusters_v2.csv` existente — cada cluster tem suas tags dominantes derivadas dos metadados reais do dataset.

### 4.2 Desempate por título

Se dois clusters empatarem em peso, o sistema usa o título do mapa como desempate via keyword matching contra os nomes dos clusters.

### 4.3 Seleção das thumbs do cluster

Com o cluster vencedor definido:
1. Busca todas as thumbs do cluster no banco
2. Ordena por `quality_score` DESC
3. Pega as top N (onde N = `slots_cluster`)
4. Retorna as URLs das imagens

---

## 5. BANCO DE SKINS

**Fonte:** `fortnite-api.com` — API pública gratuita, sem autenticação obrigatória  
**Endpoint relevante:** `GET /v2/cosmetics/br` — retorna todos os skins com nome, raridade, imagem HD, set

**Schema sugerido na tabela local:**
```
skin_id        string  (ID da Fortnite API)
name           string
rarity         string
image_url      string  (imagem HD do skin para passar como ref)
tags           string[] (ex: female, dark, glowing, armored)
updated_at     timestamp
```

**Sync:** job periódico (semanal) que chama a Fortnite API e upsert novos skins

**UX do seletor:** grid de imagens com busca por nome. Ao clicar, marca como selecionado (máximo 2). Visual de card com foto do skin + nome + raridade.

---

## 6. CONSTRUÇÃO DO PROMPT (ENGENHARIA)

O usuário nunca escreve o prompt final. O sistema constrói automaticamente a partir dos campos preenchidos.

### 6.1 Estrutura do prompt gerado

```
[INSTRUÇÃO BASE DO CLUSTER]
[PERSONAGENS E POSIÇÕES]
[ÂNGULO DE CÂMERA]
[MOOD E ATMOSFERA]
[RESTRIÇÕES FIXAS]
```

### 6.2 Instrução base por cluster

Cada cluster tem um template fixo que define a composição padrão daquele estilo. Exemplos:

**1v1:**
```
Fortnite Creative 1v1 map thumbnail. Two players on opposite sides of a tall vertical wooden Fortnite build ramp, both climbing upward simultaneously back-to-back. [PERSONAGEM_1] large in foreground right side. [PERSONAGEM_2] smaller in background left side climbing the opposite face of the ramp.
```

**Tycoon:**
```
Fortnite Creative tycoon map thumbnail. [PERSONAGEM_1] large in foreground, cheerful energetic pose. Background shows [TEMA_TYCOON] with vibrant abundance elements. Bright saturated colors, gold and warm palette.
```

**Horror:**
```
Fortnite Creative horror map thumbnail. [PERSONAGEM_1] in foreground with frightened or dramatic expression. Dark atmospheric background, moody lighting, fog effects, deep shadows.
```

> **Nota para o Codex:** os templates por cluster precisam ser refinados iterativamente com testes reais. O template do 1v1 já foi validado com 4 iterações e produz resultados comerciais. Os demais clusters precisam de sessões de refinamento similares.

### 6.3 Injeção de personagens

Se o usuário selecionou skins, o sistema injeta descrição visual de cada skin no template:

```
[PERSONAGEM_1] = "[nome do skin]: [descrição visual do skin gerada automaticamente via vision ou via campo fixo no banco]"
```

Se não selecionou skin, o template usa linguagem genérica: "a Fortnite character in the foreground".

### 6.4 Ângulo de câmera

| Opção | Injeção no prompt |
|-------|-------------------|
| Low Angle | "Low camera angle looking slightly upward, making characters appear powerful and dominant." |
| Eye Level | "Camera at eye level, direct and confrontational perspective." |
| High Angle | "High angle camera looking down, showing the full scene and environment." |
| Dutch Angle Dinâmico | "Dynamic dutch angle camera tilt, extreme energy and chaos, diagonal composition." |

### 6.5 Mood

| Tag principal | Mood padrão | Injeção no prompt |
|---------------|-------------|-------------------|
| 1v1, pvp, boxfight | Intense | "Fierce competitive atmosphere, dramatic rim lighting, high tension." |
| tycoon, simulator | Epic | "Vibrant cheerful energy, bright saturated colors, abundant and exciting." |
| horror, survival_horror | Scary | "Dark moody atmosphere, deep shadows, fog, eerie lighting." |
| parkour, race, deathrun | Fun | "Energetic playful mood, dynamic movement, bright vivid colors." |
| casual, party_game | Chill | "Relaxed friendly atmosphere, soft warm lighting, inviting composition." |

Se o usuário sobrescrever o mood, a injeção usa o mood escolhido.

### 6.6 Restrições fixas (sempre no prompt)

```
Absolutely no text, no titles, no numbers, no logos, no UI elements, no overlays anywhere in the image. 16:9 widescreen 1920x1080. Fortnite art style, vibrant saturated colors, cinematic depth of field.
```

### 6.7 Descrição da thumbnail do usuário

O texto que o usuário escreveu no campo "Descrição da thumbnail" é injetado diretamente após a instrução base, antes das restrições fixas. É o campo de maior peso no prompt.

---

## 7. HISTÓRICO DE GERAÇÕES

Cada geração é salva no banco vinculada ao usuário:

```
generation_id   uuid
user_id         uuid
created_at      timestamp
prompt_used     text        (prompt completo enviado ao Nano Banana)
image_url       string      (URL da imagem gerada)
cluster_used    string
skins_used      string[]
tags_input      string[]
mood_used       string
```

**UX:** galeria de thumbs geradas ordenada por data. Cada card tem opção de download e futuramente "Editar esta thumb" (endpoint `fal-ai/nano-banana-2/edit` com a imagem gerada como input).

---

## 8. FEATURE "CONTEXTO EXTERNO"

Internamente: parâmetro `web_search: true/false` no payload do Nano Banana 2.

**Exibição no UI:** toggle com nome "Contexto Externo" ou "Turbinar com IA". On por padrão.

Custo adicional quando ativo: $0.015 por geração (não precisa ser exibido pro usuário).

---

## 9. FLUXO COMPLETO DE UMA GERAÇÃO

```
1. Usuário preenche formulário
2. Backend recebe os campos
3. Algoritmo de cluster roda → define cluster_vencedor
4. Sistema busca top N thumbs do cluster_vencedor por quality_score
5. Sistema monta o prompt final (template + personagens + ângulo + mood + descrição do usuário + restrições)
6. Sistema monta o array de image_urls:
   - URLs dos skins selecionados (da tabela local via fortnite-api.com)
   - URL da ref do usuário (se enviou)
   - URLs das thumbs do cluster (slots restantes)
7. Chamada ao fal-ai/nano-banana-2/edit com prompt + image_urls + web_search
8. Resposta retorna URL da imagem gerada
9. Salva no histórico vinculado ao usuário
10. Exibe no frontend com opção de download
```

---

## 10. O QUE NÃO MUDA NO SISTEMA ATUAL

- Tabela de clusters e pipeline de clusterização (`clusters_v2.csv`)
- Quality scores das thumbs existentes
- Infraestrutura fal.ai (só muda o endpoint usado)
- Pipeline de captions (pode ser usado futuramente para enriquecer descrições de skins)

---

## 11. O QUE PRECISA SER FEITO (ORDEM SUGERIDA)

### ETAPA 1 — Regenerar clusters com qualidade (fazer antes de tudo)

A clusterização anterior foi feita com foco em **volume** para treino de LoRA. Agora que o sistema é de referência visual, o critério muda: **só entram thumbs com quality score alto**.

**O que o Codex deve fazer:**

1. Deletar todos os clusters existentes (`clusters_v2.csv` e dados derivados)
2. Buscar no banco todas as thumbs com `quality_score >= [threshold definido]`
3. Rodar o pipeline de clusterização existente **somente sobre esse subset filtrado**
4. Gerar novos clusters com nomes descritivos baseados nos metadados dominantes de cada cluster (título, tags, map_type)
5. Exportar novo `clusters_v3.csv` com: `image_id`, `cluster_id`, `cluster_name`, `quality_score`

**Por que isso importa:**
- Remove thumbs de baixa qualidade que contaminariam as refs do Nano Banana
- Clusters menores e mais puros → refs mais coerentes → melhor resultado de geração
- Os nomes dos clusters precisam ser descritivos porque são usados no algoritmo de mapeamento tag → cluster

**Threshold sugerido:** usar o percentil 70 do quality_score atual como corte mínimo — ajustar após ver a distribuição resultante.

**Validação:** após gerar, confirmar que os clusters top (1v1, tycoon, horror, race, etc.) têm ao menos 50 thumbs cada. Clusters com menos de 50 thumbs após o filtro devem ser fundidos com o cluster mais próximo semanticamente.

---

### Sequência completa após ETAPA 1

2. Criar tabela de skins no banco + job de sync com fortnite-api.com
3. Criar tabela de gerações (histórico)
4. Criar tabela de mapeamento tag → cluster com pesos (usando os nomes dos novos clusters)
5. Implementar algoritmo de seleção de cluster
6. Implementar builder de prompt por cluster (começar com 1v1 que já está validado)
7. Implementar processador leve de descrição do usuário (Gemini Flash via OpenRouter — converte texto vago do usuário em linguagem visual limpa antes de injetar no template)
8. Implementar endpoint de geração no backend
9. Implementar frontend: formulário + seletor de skins + resultado + histórico
10. Refinamento iterativo dos templates de prompt por cluster (sessões de teste)

---

## 12. TEMPLATES DE PROMPT — STATUS

> ⚠️ **Os nomes dos clusters desta seção só existem após a Etapa 1 ser executada.** Não hardcodar nomes de clusters antes disso. Após a Etapa 1, o Codex deve popular esta seção com os nomes reais gerados pelo pipeline de clusterização.

**Status geral:** todos os templates estão pendentes de refinamento com a nova arquitetura de campos.

O template de 1v1 foi testado em sessão anterior (4 iterações, resultado comercial visual confirmado), mas com campos diferentes dos atuais — sem ângulo de câmera, sem mood, sem processamento da descrição do usuário via Gemini Flash. O template precisa ser revalidado com a arquitetura completa antes de ir para produção.

**Prompt de referência do 1v1 (última versão testada — base para revalidação):**

```
Fortnite Creative 1v1 map thumbnail. Absolutely no text, no titles, no numbers, 
no logos, no UI elements anywhere in the image.

SCENE STRUCTURE: A single tall vertical wooden Fortnite build ramp dominates the 
center of the image, like a steep staircase structure made of rough wooden planks, 
rising from bottom to top of frame. The two characters are on OPPOSITE SIDES of 
this same ramp structure, both climbing upward simultaneously, with their backs 
to each other — separated by the ramp between them.

[PERSONAGEM_1] — right side foreground: closest character to the camera, large, 
climbing up the right face of the ramp. Back is toward the camera but head turns 
sharply to look back over shoulder directly at the viewer with a fierce competitive 
expression. [DESCRIÇÃO VISUAL DO SKIN]. Body in dynamic climbing stride, one knee raised.

[PERSONAGEM_2] — left side background: on the opposite face of the ramp, slightly 
smaller due to depth, climbing upward with back fully turned away from [PERSONAGEM_1] 
and toward the left side of the frame. [DESCRIÇÃO VISUAL DO SKIN]. Posture aggressive 
and fast, arms forward reaching up the ramp planks.

CAMERA: [INJEÇÃO DE ÂNGULO]

ENVIRONMENT: Bright vivid cyan-blue sky background. Clean flat green grid floor. 
Saturated vibrant colors, dramatic rim lighting on both characters from opposite sides. 
[INJEÇÃO DE MOOD]. 16:9 widescreen 1920x1080.
```

**Processo de refinamento por cluster (após Etapa 1):**
1. Identificar os clusters gerados com seus nomes reais
2. Para cada cluster: analisar as top 20 thumbs por quality_score e identificar padrões de composição dominantes
3. Escrever template base inspirado nesses padrões
4. Testar com 3-5 iterações usando skins reais
5. Aprovar template e marcar cluster como pronto para produção
6. Estratégia de lançamento: começar com os 3 clusters de maior volume após a Etapa 1, refinar demais em paralelo com uso real
