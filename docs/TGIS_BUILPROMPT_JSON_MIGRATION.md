# TGIS — buildPrompt: Migração de Texto para JSON
**Para o Codex — 2026-03-04**

---

## Contexto e Motivação

O `buildPrompt` em `supabase/functions/tgis-generate/index.ts` atualmente gera um prompt em **texto plano com labels** (`Base direction:`, `Action focus:`, `Color emphasis:`, etc.). Isso funciona parcialmente, mas foi validado através de pesquisa nos repositórios de prompt engineering do Nano Banana 2 que o modelo lê **JSON hierárquico** com muito mais precisão do que texto plano — cada chave JSON vira um slot de atenção separado no modelo, eliminando conflitos semânticos entre blocos.

**Esta tarefa é exclusivamente uma mudança de formato de output.** Toda a lógica de processamento anterior (sanitizador, preprocessador de intent, templates, conditional character logic) permanece **100% igual**. O que muda é apenas o que é montado no `final_prompt` que vai para a fal.ai.

---

## O que NÃO muda

- Função `processUserIntent()` — permanece igual
- Lógica de sanitização — permanece igual
- Templates em `tgis_prompt_templates` — permanecem iguais
- Lógica condicional de personagens (0/1/2 skins) — permanece igual
- Bloco `EPIC GAMES CONTENT POLICY` — permanece obrigatório, vai para o campo `negative.epic_policy`
- Slot system de imagens de referência — permanece igual
- Salvamento no `tgis_generation_log` — permanece igual

---

## O que muda

**Apenas o output da função `buildPrompt`.** Em vez de retornar uma string de texto, retorna um objeto JSON serializado (`JSON.stringify`) que é enviado como prompt para o Nano Banana 2.

---

## Estrutura JSON alvo do final_prompt

### Cluster com 0 skins

```json
{
  "scene": {
    "type": "Fortnite Creative tycoon thumbnail",
    "composition": "A dominant hero character in the foreground with clear triumphant energy and strong silhouette readability. Background must show progression-rich tycoon environment (factories/shops/upgrades/reward ecosystem) with strong depth layering from foreground to horizon. Use bright saturated warm-gold palette balanced with clean sky/cool accents, cinematic contrast, and high visual clarity at thumbnail size. Prioritize reward fantasy, abundance cues, and a single clear focal hierarchy without split-screen layout or text-based focal elements.",
    "depth_layers": {
      "foreground": "dominant hero character with triumphant pose, oversized gold coins",
      "midground": "money bags scattered, floating shop upgrade icons",
      "background": "tall luxury skyscrapers, rich tycoon skyline"
    }
  },
  "characters": {
    "primary": {
      "identity": "generic Fortnite character, no fixed skin",
      "pose": "relaxed triumphant pose",
      "position": "dominant foreground center, large scale"
    }
  },
  "environment": {
    "elements": ["tall luxury skyscrapers", "floating shop upgrade icons", "money bags scattered around"],
    "color_palette": "bright gold and sky blue",
    "composition_style": "diagonal upward composition"
  },
  "photography": {
    "style": "Fortnite cinematic 3D render, vibrant saturated art style",
    "aspect_ratio": "16:9 widescreen 1920x1080",
    "camera_angle": "eye level, direct perspective",
    "depth_of_field": "shallow, strong foreground-midground-background separation",
    "color_grading": "vibrant, high saturation, cinematic contrast"
  },
  "mood": "Vibrant cheerful energy, bright saturated colors, abundant and exciting",
  "negative": {
    "text_elements": "no text, no titles, no numbers, no logos, no UI overlays, no HUD elements anywhere in the image",
    "epic_policy": "no real-world currency, no dollar bills, no banknotes, no currency symbols ($, EUR, GBP, BRL, JPY), no V-Bucks symbols, no Battle Pass references, no XP bars, no progress bar UI, no Epic Games logos, no console controller buttons (A/B/X/Y, L2/R2), no real people photographs, no alcohol, no drugs, no gambling imagery, no violent gore, no realistic blood, no sexual content, no URLs, no social media handles"
  }
}
```

### Cluster com 1 skin

```json
{
  "scene": {
    "type": "Fortnite Creative tycoon thumbnail",
    "composition": "[base_direction do template do cluster]",
    "depth_layers": {
      "foreground": "[skin name] in triumphant pose on mountain of oversized gold coins",
      "midground": "money bags scattered, floating shop upgrade icons",
      "background": "tall luxury skyscrapers, rich tycoon skyline"
    }
  },
  "characters": {
    "primary": {
      "identity": "Fishstick: [vision description completa do skin]",
      "pose": "relaxed triumphant pose",
      "position": "dominant foreground left, large scale"
    }
  },
  "environment": {
    "elements": ["tall luxury skyscrapers", "floating shop upgrade icons", "money bags scattered around"],
    "color_palette": "bright gold and sky blue",
    "composition_style": "diagonal upward composition"
  },
  "photography": {
    "style": "Fortnite cinematic 3D render, vibrant saturated art style",
    "aspect_ratio": "16:9 widescreen 1920x1080",
    "camera_angle": "eye level, direct perspective",
    "depth_of_field": "shallow, strong foreground-midground-background separation",
    "color_grading": "vibrant, high saturation, cinematic contrast"
  },
  "mood": "Vibrant cheerful energy, bright saturated colors, abundant and exciting",
  "negative": {
    "text_elements": "no text, no titles, no numbers, no logos, no UI overlays, no HUD elements anywhere in the image",
    "epic_policy": "no real-world currency, no dollar bills, no banknotes, no currency symbols ($, EUR, GBP, BRL, JPY), no V-Bucks symbols, no Battle Pass references, no XP bars, no progress bar UI, no Epic Games logos, no console controller buttons (A/B/X/Y, L2/R2), no real people photographs, no alcohol, no drugs, no gambling imagery, no violent gore, no realistic blood, no sexual content, no URLs, no social media handles"
  }
}
```

### Cluster com 2 skins

```json
{
  "scene": {
    "type": "Fortnite Creative duel thumbnail",
    "composition": "[base_direction do template do cluster 1v1]",
    "depth_layers": {
      "foreground": "Fishstick climbing wooden ramp aggressively, looking back with intense eyes — dominant left side",
      "midground": "wooden ramp structure center frame",
      "background": "Peely reaching upward on opposite ramp face — smaller, right side — cyan sky"
    }
  },
  "characters": {
    "primary": {
      "identity": "Fishstick: [vision description completa do skin]",
      "pose": "climbing aggressively, looking back at camera with intense eyes",
      "position": "dominant foreground left, large scale"
    },
    "secondary": {
      "identity": "Peely: [vision description completa do skin]",
      "pose": "reaching upward",
      "position": "background right, smaller scale, less prominent"
    }
  },
  "environment": {
    "elements": ["wooden ramp", "cyan sky"],
    "color_palette": "cyan with dramatic rim lighting",
    "composition_style": "dynamic action shot, confrontation line"
  },
  "photography": {
    "style": "Fortnite cinematic 3D render, vibrant saturated art style",
    "aspect_ratio": "16:9 widescreen 1920x1080",
    "camera_angle": "slightly low angle, emphasizes action",
    "depth_of_field": "shallow, strong foreground-midground-background separation",
    "color_grading": "vibrant, high saturation, cinematic contrast, dramatic rim lighting"
  },
  "mood": "Fierce competitive atmosphere, dramatic rim lighting, high tension",
  "negative": {
    "text_elements": "no text, no titles, no numbers, no logos, no UI overlays, no HUD elements anywhere in the image",
    "epic_policy": "no real-world currency, no dollar bills, no banknotes, no currency symbols ($, EUR, GBP, BRL, JPY), no V-Bucks symbols, no Battle Pass references, no XP bars, no progress bar UI, no Epic Games logos, no console controller buttons (A/B/X/Y, L2/R2), no real people photographs, no alcohol, no drugs, no gambling imagery, no violent gore, no realistic blood, no sexual content, no URLs, no social media handles"
  }
}
```

---

## Mapeamento: campos atuais → campos JSON

| Campo atual (texto) | Campo JSON |
|---|---|
| `Base direction: [template]` | `scene.composition` |
| `Depth layering: foreground X, midground Y, background Z` | `scene.depth_layers.foreground/midground/background` |
| `Action focus: [main_subject_action]` | `scene.depth_layers.foreground` (integrado) |
| `Character A = [skin]: [description]` | `characters.primary.identity` |
| `Character B = [skin]: [description]` | `characters.secondary.identity` |
| `Character pose emphasis: [pose]` | `characters.primary.pose` / `characters.secondary.pose` |
| `Camera direction: [camera]` | `photography.camera_angle` |
| `Mood and atmosphere: [mood]` | `mood` |
| `Color emphasis: [color]` | `environment.color_palette` |
| `Environment direction: [elements]` | `environment.elements` (array) |
| `Composition adaptation: [style]` | `environment.composition_style` |
| `Hard constraints: [texto]` | `negative.text_elements` |
| `EPIC GAMES CONTENT POLICY: [texto]` | `negative.epic_policy` |
| `Reference mapping: Images #1-#14` | **REMOVIDO do JSON** — as imagens já são enviadas como array separado para a fal.ai. Não incluir no JSON de texto. |
| `Reference policy: [texto]` | **REMOVIDO do JSON** — a fal.ai processa as imagens automaticamente. |
| `Composition rules: [texto]` | Incorporado em `photography.depth_of_field` e `scene.composition` |
| `Tag context: [tags]` | **REMOVIDO do JSON** — tags já foram usadas para routing do cluster. Não incluir. |

---

## Regras de construção do JSON

### `scene.composition`
Vem **diretamente** do campo `base_direction` do template do cluster em `tgis_prompt_templates`. Não modificar, não resumir, copiar exato.

### `scene.depth_layers`
Construído a partir de dois inputs combinados:
1. `depth_layers` do `processed_intent_json` — define o que está em cada camada
2. Personagens do slot system — injetados na camada correta (primary vai para `foreground`, secondary vai para `background`)

Exemplo de combinação:
```
// processed_intent_json.depth_layers = "foreground with Fishstick, background with Peely"
// skin[0] = Fishstick, skin[1] = Peely

scene.depth_layers = {
  foreground: "Fishstick climbing wooden ramp aggressively — dominant left side",
  midground: "wooden ramp structure",
  background: "Peely reaching upward — smaller right side — cyan sky"
}
```

### `characters`
Regra condicional já implementada anteriormente — apenas mudar o destino:

```typescript
// 0 skins
characters: {
  primary: {
    identity: "generic Fortnite character, no fixed skin",
    pose: processedIntent.character_pose,
    position: "dominant foreground, large scale"
  }
}

// 1 skin
characters: {
  primary: {
    identity: `${skin[0].name}: ${skin[0].visionDescription}`,
    pose: processedIntent.character_pose,
    position: "dominant foreground, large scale"
  }
}

// 2 skins
characters: {
  primary: {
    identity: `${skin[0].name}: ${skin[0].visionDescription}`,
    pose: processedIntent.character_pose,
    position: "dominant foreground left, large scale"
  },
  secondary: {
    identity: `${skin[1].name}: ${skin[1].visionDescription}`,
    pose: "opposing action, readable at thumbnail size",
    position: "background right, smaller scale"
  }
}
```

### `environment.elements`
Vem do `processedIntent.environment_elements` — já é um array, usar diretamente.

### `photography.camera_angle`
Vem da seleção de câmera do usuário no frontend, mapeado para texto descritivo:

| Opção do usuário | Valor em `photography.camera_angle` |
|---|---|
| Low Angle | `"low angle looking slightly upward, characters appear powerful"` |
| Eye Level | `"eye level, direct and confrontational perspective"` |
| High Angle | `"high angle looking down, full scene visible"` |
| Dutch Angle | `"dynamic dutch angle tilt, extreme energy, diagonal composition"` |

### `mood`
Vem do mood do cluster (determinado pelas tags), igual à lógica atual. Se o usuário sobrescrever, usar o mood escolhido.

### `negative`
**Sempre fixo e completo.** Nunca truncar, nunca remover itens. O campo `negative.epic_policy` é obrigatório em 100% das gerações — é a última linha de defesa antes do Nano Banana.

---

## Como enviar para a fal.ai

O JSON montado é serializado com `JSON.stringify` e enviado como o campo `prompt` da chamada à fal.ai. As imagens de referência continuam sendo enviadas no campo `image_url` (ou equivalente da API) como array separado — **não mudam**.

```typescript
const finalPromptJson = buildPrompt({
  cluster,
  template,
  processedIntent,
  skins,
  cameraAngle,
  mood,
  tags
});

const falPayload = {
  prompt: JSON.stringify(finalPromptJson),  // JSON serializado como string
  image_url: referenceImages,              // array de URLs — não muda
  // demais parâmetros da fal.ai — não mudam
};
```

---

## Validação após implementação

Antes de rodar no Nano Banana, rodar os 17 casos de teste do `prompt_engine_test_cases.json` novamente. O campo `final_prompt` no output deve:

1. Começar com `{` — confirma que é JSON
2. Ter todos os campos: `scene`, `characters`, `environment`, `photography`, `mood`, `negative`
3. `negative.epic_policy` presente e completo em todos os 17 casos
4. `characters.secondary` ausente nos casos com 0 ou 1 skin
5. `scene.depth_layers` ter `foreground`, `midground` e `background` como sub-campos separados
6. Nenhuma referência a `Reference mapping`, `Tag context`, `Reference policy` ou `Composition rules` como campos no JSON — esses foram removidos

---

## Por que JSON e não texto

Confirmado pelos repositórios de prompt engineering do Nano Banana 2 com 5k+ stars e exemplos com resultados publicados:

- O modelo processa cada chave JSON como um slot de atenção **separado e independente**
- Em texto plano, `Color emphasis: dramatic rim lighting` e `Mood: Fierce competitive` competem no mesmo espaço semântico
- Em JSON, `photography.color_grading` e `mood` são campos distintos que o modelo processa sem conflito
- O campo `negative` em JSON é mais efetivo do que constraints no final de um bloco de texto — o modelo aprende que `negative` significa "suprimir", não "considerar"
- Prompts complexos com múltiplos personagens, ambientes específicos e constraints obrigatórias performam consistentemente melhor em JSON estruturado

---

*TGIS buildPrompt JSON Migration — Epic Insight Engine — 2026-03-04*
