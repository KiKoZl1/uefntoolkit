# TGIS — Layer Decomposition Tool PRD v1.0
## Exportar Thumb em Layers Editáveis

**Data:** 2026-03-04
**Owner:** Denny
**Status:** Pronto para Implementação
**Contexto:** Epic Insight Engine / Surprise Radar — TGIS ThumbTools

---

## 0. Contexto e Validação

### O que é

Uma tool dentro do sistema de ThumbTools do TGIS que decompõe a thumb gerada em múltiplas camadas RGBA independentes. O usuário vê as layers num canvas interativo com show/hide, pode inspecionar cada elemento separadamente e baixar os PNGs com transparência para editar em qualquer software externo (Photoshop, Canva, Figma).

### Validação realizada

Testado diretamente no fal.ai com a thumb de horror gerada pelo TGIS — resultado perfeito em 4 layers:

- **Layer 1:** Background da cena (beco abandonado com névoa)
- **Layer 2:** Personagem principal (monstro silhueta)
- **Layer 3:** Efeito de luz (lanterna, feixe de luz)
- **Layer 4:** Personagem secundário (Fishstick com lanterna)

Cada layer retornou como PNG RGBA com transparência real, pronto para composição externa.

### O modelo: Qwen-Image-Layered

- **Endpoint fal.ai:** `fal-ai/qwen-image-layered`
- **Custo:** **$0.05 por decomposição — fixo, independente do número de layers**
- **Tempo:** 15-30 segundos
- **Layers:** 1 a 10 (slider controlado pelo usuário)
- **Output:** Array de PNGs RGBA individuais
- **Licença:** Apache 2.0

O custo não escala com quantidade de layers nem com inference steps. 10 layers custa o mesmo que 4 — $0.05 fixo.

---

## 1. O que o Usuário Vê

### Canvas interativo de layers

Após a decomposição, o usuário vê:

```
┌─────────────────────────────────────────────────────┐
│  LAYERS                                    [ZIP ↓]  │
├─────────────────────────────────────────────────────┤
│  👁 ▬▬▬  Background_Layer_1        [PNG ↓]         │
│  👁 ▬▬▬  Character_Main_Layer_2    [PNG ↓]         │
│  👁 ▬▬▬  Light_Effect_Layer_3      [PNG ↓]         │
│  👁 ▬▬▬  Character_Secondary_Layer_4 [PNG ↓]       │
├─────────────────────────────────────────────────────┤
│                                                     │
│         [preview do canvas com layers ativos]       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- **Ícone de olho** → toggle show/hide do layer no canvas
- **Thumbnail do layer** → preview do PNG com fundo xadrez (transparência)
- **Nome do layer** → gerado automaticamente pelo Vision (em inglês, formato fixo)
- **[PNG ↓]** → download individual do layer
- **[ZIP ↓]** → download de todos os layers num arquivo zip

### Comportamento do canvas

O canvas mostra a composição em tempo real conforme o usuário ativa/desativa layers. Com todos ativos = thumb original. Com só o layer do personagem = personagem isolado com fundo transparente. Fundo xadrez padrão indica transparência.

---

## 2. Nomenclatura dos Layers

### Auto-naming via Vision

O modelo retorna layers anônimos (`images[0]`, `images[1]`, etc.). O sistema chama o Vision (GPT-4o) com cada layer PNG para identificar o conteúdo e gerar um nome padronizado.

### Formato fixo de nomenclatura

```
{SemanticName}_Layer_{N}
```

Onde `{SemanticName}` é sempre em inglês, capitalizado, sem espaços:

| Conteúdo detectado | Nome gerado |
|---|---|
| Céu, ambiente de fundo | `Background_Layer_1` |
| Personagem principal | `Character_Main_Layer_2` |
| Personagem secundário | `Character_Secondary_Layer_3` |
| Efeito de luz, flash, glow | `Light_Effect_Layer_4` |
| Névoa, fumaça, partículas | `Atmosphere_Layer_5` |
| Foreground, objeto na frente | `Foreground_Layer_6` |
| Texto ou UI elements | `UI_Layer_7` |
| Sombra ou overlay | `Shadow_Layer_8` |
| Elemento genérico | `Element_Layer_N` |

### Prompt para o Vision (auto-naming)

```
This is a transparent PNG layer extracted from a Fortnite Creative thumbnail.
Identify the main semantic content of this layer in 1-3 words.
Return ONLY the name in PascalCase, no spaces, no explanation.
Examples: Background, CharacterMain, CharacterSecondary, LightEffect, 
Atmosphere, Foreground, ShadowOverlay, UIElement
```

O sistema concatena com `_Layer_{N}` automaticamente.

---

## 3. Slider de Layers

O usuário controla o número de layers antes de decompor. Interface: slider de 2 a 10 com valor padrão em 4.

```
Layers: [2 ──●──────────── 10]  4 layers
```

**Custo é sempre $0.05 independente do valor escolhido.**

Recomendação exibida na UI por faixa:
- **2-3 layers:** Cenas simples, fundo + personagem
- **4-6 layers:** Sweet spot para thumbs de Fortnite ✓
- **7-10 layers:** Cenas complexas com múltiplos elementos

---

## 4. Download

### Download individual

Cada layer tem seu próprio botão de download. Baixa o PNG RGBA com o nome padronizado:
```
Background_Layer_1.png
Character_Main_Layer_2.png
Light_Effect_Layer_3.png
Character_Secondary_Layer_4.png
```

### Download ZIP

Botão global no topo do painel. Comprime todos os layers num ZIP nomeado com o código da thumb:
```
thumb_{link_code}_layers.zip
├── Background_Layer_1.png
├── Character_Main_Layer_2.png
├── Light_Effect_Layer_3.png
└── Character_Secondary_Layer_4.png
```

O ZIP é gerado no frontend (JSZip) — sem custo de servidor, sem storage extra.

---

## 5. Implementação Técnica

### Stack

- **fal.ai** — `fal-ai/qwen-image-layered` para decomposição
- **Vision (GPT-4o)** — auto-naming de cada layer
- **JSZip** — geração do ZIP no frontend
- **Canvas API ou Fabric.js** — composição interativa com show/hide
- **Webhook existente** — mesmo sistema do TGIS recebe os resultados

### Chamada fal.ai

```typescript
const decomposeLayers = async (thumbUrl: string, numLayers: number) => {
  const result = await fal.subscribe('fal-ai/qwen-image-layered', {
    input: {
      image_url: thumbUrl,
      num_layers: numLayers,  // 2-10, escolhido pelo usuário
    },
    onQueueUpdate: (update) => {
      // atualiza loading state (15-30s)
    }
  });

  // result.images = array de { url, width, height }
  return result.images; // cada item é um PNG RGBA
};
```

### Auto-naming via Vision

```typescript
const nameLayer = async (layerUrl: string, index: number): Promise<string> => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: layerUrl }
          },
          {
            type: 'text',
            text: `This is a transparent PNG layer from a Fortnite thumbnail.
Identify the main content in 1-3 words. Return ONLY PascalCase, no spaces.
Examples: Background, CharacterMain, LightEffect, Atmosphere, Foreground`
          }
        ]
      }]
    })
  });

  const data = await response.json();
  const semanticName = data.content[0].text.trim();
  return `${semanticName}_Layer_${index + 1}`;
};
```

### Canvas com show/hide

```typescript
interface Layer {
  url: string;
  name: string;
  visible: boolean;
  canvas: HTMLCanvasElement;
}

// Re-compõe o canvas master quando usuário toggled visibility
const recompose = (layers: Layer[], masterCanvas: HTMLCanvasElement) => {
  const ctx = masterCanvas.getContext('2d');
  ctx.clearRect(0, 0, masterCanvas.width, masterCanvas.height);

  // Renderiza layers de baixo para cima (layer_0 = fundo)
  layers.forEach(layer => {
    if (layer.visible) {
      ctx.drawImage(layer.canvas, 0, 0);
    }
  });
};
```

### Geração do ZIP no frontend

```typescript
import JSZip from 'jszip';

const downloadAllLayers = async (layers: Layer[]) => {
  const zip = new JSZip();

  for (const layer of layers) {
    const response = await fetch(layer.url);
    const blob = await response.blob();
    zip.file(`${layer.name}.png`, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `thumb_${linkCode}_layers.zip`;
  a.click();
};
```

### UX Flow completo

```
1. Usuário gera thumb via TGIS
2. ThumbTools exibe botão "Exportar em Layers"
3. Usuário ajusta slider (padrão: 4 layers)
4. Usuário clica "Decompor"
5. Loading state (15-30s) com thumb original visível
6. fal.ai retorna array de PNGs RGBA
7. Vision nomeia cada layer em paralelo (~2s)
8. Canvas aparece com todos os layers ativos
9. Usuário faz show/hide, inspeciona, baixa individualmente ou ZIP
```

---

## 6. Custo e Billing

| Item | Custo |
|---|---|
| Decomposição (qualquer nº de layers) | **$0.05 fixo** |
| Auto-naming Vision (por layer, ~10 tokens) | **~$0.001 total** |
| Download ZIP | **$0.00 (frontend)** |
| **Total por uso** | **~$0.051** |

Modelo de cobrança para o usuário: cobrar equivalente a 50% de uma geração completa — é um valor percebido alto (horas de Photoshop eliminadas) entregue por centavos de custo.

---

## 7. Versões Futuras (Fora do Escopo da v1)

### v2 — Decomposição Recursiva

O modelo suporta decompor qualquer layer novamente em sub-layers. O usuário clicaria num layer e pediria mais separação. Exemplo: decompor o layer "Character_Main" em "Character_Body", "Character_Head", "Character_Weapon".

Fluxo técnico: mesma chamada `fal-ai/qwen-image-layered` mas passando a URL do layer individual em vez da thumb completa. O resultado seria uma árvore de layers (layer → sub-layers).

A complexidade é na UI — representar hierarquia de layers e gerenciar o canvas em múltiplos níveis.

### v2 — Editar Layer e Reconstruir

O usuário seleciona um layer → abre o Edit Mode com brush → edita → o sistema recombina todos os layers para reconstruir a thumb completa.

A reconstrução usa composição simples: empilha os layers em ordem com Canvas API. O layer editado substitui o original. Não requer chamada de API — é operação de canvas puro.

O desafio é preservar a ordem correta dos layers (fundo → foreground) e gerenciar o estado de "qual versão de cada layer está ativa". Requer sistema de versionamento de layers no Supabase antes de implementar.

---

## 8. O que Esta Tool Não Faz

**Não edita os layers.** A v1 é apenas decomposição e exportação. Edição de layers individuais é escopo do Edit Mode (TGIS_EDIT_MODE_PRD_v1.md) e da integração v2.

**Não garante separação perfeita.** O modelo faz separação semântica — elementos com bordas complexas (cabelos, névoa, partículas) podem ter bleeding entre layers. Para thumbs de Fortnite com elementos bem definidos o resultado é excelente como validado nos testes.

**Não salva os layers no Supabase (v1).** As URLs do fal.ai são temporárias. O usuário precisa baixar antes de fechar. Persistência de layers é feature de v2 junto com a edição.

---

**Documento criado em:** 2026-03-04
**Baseado nos testes de:** 2026-03-04 — thumb de horror decomposta em 4 layers com resultado validado
**Modelo validado:** fal-ai/qwen-image-layered · $0.05/decomposição · 15-30s · até 10 layers
