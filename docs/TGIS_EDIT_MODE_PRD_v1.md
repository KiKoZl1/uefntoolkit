# TGIS — Edit Mode PRD v1.0
## Três Features de Edição Pós-Geração

**Data:** 2026-03-04
**Owner:** Denny
**Status:** Pronto para Implementação
**Contexto:** Epic Insight Engine / Surprise Radar — TGIS

---

## 0. Contexto e Decisões que Levaram a Este PRD

### O estado atual do TGIS

O TGIS completou sua primeira fase com sucesso. O pipeline de geração está validado:

- **Modelo:** Nano Banana 2 (Gemini 3.1 Flash Image Preview) via fal.ai
- **Prompt engine:** JSON estruturado com arquitetura enxuta — `user_intent` melhorado + personagens + câmera + mood + constraints
- **Referências visuais:** 11-14 thumbs do cluster enviadas junto ao prompt
- **Validação de qualidade:** 17 casos de teste passaram, incluindo clusters tycoon e horror


### Por que essas 3 features agora

Com a geração funcionando corretamente, o próximo passo natural é **o que acontece depois da geração**. O usuário recebeu a thumb — agora ele quer refiná-la sem gerar do zero novamente.

As 3 features usam a mesma API que já existe (Nano Banana 2) em modo de edição/inpainting. Nenhuma lib nova. Nenhuma infraestrutura nova.

---

## 1. Feature 1 — Edição com Brush + Prompt

### O que é

O usuário recebe a thumb gerada e pode selecionar uma região com um brush. Ele digita o que quer mudar naquela região. O sistema manda a thumb original + máscara + prompt melhorado para o Nano Banana 2 e retorna a imagem editada.

### Por que faz sentido

O Nano Banana 2 foi projetado para este fluxo nativamente. Inpainting com máscara é uma das capacidades core do modelo — a mesma API, os mesmos parâmetros, só com o campo de máscara adicionado.

### Fluxo técnico

```
1. Frontend: usuário ativa "modo edição" na thumb gerada
2. Canvas brush: usuário pinta a região a ser editada (brush branco sobre fundo preto)
3. Usuário digita o prompt: "adiciona uma explosão de energia atrás do personagem"
4. Sistema reescreve o prompt com GPT-4o-mini (mesmo preprocessor existente)
5. fal.ai recebe:
   - image_url: URL da thumb original (já salva no Supabase)
   - mask_url: máscara gerada pelo canvas (branco = editar, preto = preservar)
   - prompt: JSON enxuto com user_intent = prompt melhorado
6. Nano Banana retorna imagem editada
7. Sistema salva nova versão e exibe side-by-side com original
```

### Contrato da máscara

A máscara precisa ser uma imagem PNG em escala de cinza:
- **Branco (255)** = área que o modelo pode modificar
- **Preto (0)** = área que deve ser preservada intacta

O canvas brush no frontend pinta de branco sobre um canvas transparente/preto sobreposto à thumb. Na hora do envio, exporta como PNG 1920x1080 e envia como base64 ou faz upload para fal.ai storage.

### Implementação do brush

Fabric.js ou Canvas API puro são suficientes. Não é necessário nenhuma lib de inpainting — só um brush simples que pinta de branco. Parâmetros do brush: tamanho ajustável (20-200px), hardness fixo, cor sempre branca.

### Prompt para edição

O prompt de edição segue a mesma arquitetura enxuta:
```json
{
  "user_intent": "[descrição melhorada do que o usuário quer na região mascarada]",
  "constraints": {
    "technical": "preserve all unmasked areas exactly, seamless integration with existing scene, 16:9 1920x1080",
    "epic_policy": "[bloco fixo]"
  }
}
```

O campo `characters` e `mood` são omitidos na edição — as refs e a imagem original já estabelecem o contexto visual.

### Custo

1 chamada Nano Banana 2 = ~$0.08-0.15 dependendo da resolução de saída.

---

## 2. Feature 2 — Troca de Personagem com Brush

### O que é

O usuário passa o brush por cima de um personagem na thumb e escolhe um novo personagem (skin Fortnite oficial do dropdown existente). O sistema substitui o personagem mantendo pose, iluminação e composição da cena.

### Por que é Feature separada da Feature 1

Tecnicamente usa o mesmo mecanismo (thumb + máscara + prompt). O que muda é o **prompt de troca de personagem** — ele precisa instruir o modelo a preservar a pose e integração visual com a cena, não só "colocar algo novo na região". É um caso de uso suficientemente específico para ter UX própria.

### Fluxo técnico

```
1. Frontend: usuário ativa "trocar personagem" 
2. Canvas brush: usuário pinta por cima do personagem a ser trocado
3. Dropdown: usuário seleciona o novo personagem (lista de skins disponíveis)
4. Sistema monta o prompt de troca (sem LLM — é template fixo)
5. fal.ai recebe:
   - image_url: thumb original
   - mask_url: máscara do personagem
   - prompt: JSON de troca
6. Nano Banana retorna imagem com personagem substituído
```

### Prompt de troca de personagem

Template fixo — não passa pelo preprocessor LLM:
```json
{
  "user_intent": "Replace the character in the masked region with [NOVO_PERSONAGEM]. Maintain exactly the same pose, body angle, and action as the original character. Preserve the original lighting direction, shadows, and rim lighting on the new character. Seamlessly integrate the new character into the existing scene composition, keeping all background elements unchanged.",
  "constraints": {
    "technical": "preserve all unmasked areas exactly, maintain pose and composition, seamless lighting integration, 16:9 1920x1080",
    "epic_policy": "[bloco fixo]"
  }
}
```

O campo `[NOVO_PERSONAGEM]` é substituído pela descrição do skin selecionado no dropdown.

### Descrições dos skins no dropdown

Cada skin no sistema tem uma `vision_description` que foi gerada previamente — a descrição visual detalhada do personagem. Essa descrição é o que vai no `[NOVO_PERSONAGEM]`.

Exemplo para Fishstick:
> "Fishstick: an orange anthropomorphic fish character with large expressive white eyes, yellow fins as hands, wearing a teal vest and brown belt, iconic Fortnite art style"

### Custo

1 chamada Nano Banana 2. Mesmo custo da Feature 1.

---

## 3. Feature 3 — Personagem Custom via Upload

### O que é

O usuário faz upload de uma imagem de qualquer personagem — skin customizada, monstro, vilão, OC, versão especial de um skin existente. O sistema usa Vision (GPT-4o) para descrever o personagem em detalhes e usa essa descrição como o `identity` do personagem na geração. A imagem do personagem também é enviada como referência adicional para ancorar visualmente.

### Por que é importante

O sistema atual só suporta skins Fortnite oficiais pré-cadastradas. Fortnite Creative tem um ecossistema rico de personagens customizados, mashups, versões alternativas, NPCs únicos de mapas específicos. Fechar o sistema em skins oficiais limita diretamente quem pode usar o TGIS.

### Lógica da solução

**O Vision descreve, a imagem ancora.**

O Nano Banana 2 não consegue reproduzir um personagem customizado pixel-perfect só por texto. Mas a combinação de:
1. Descrição textual detalhada gerada pelo Vision (para o prompt JSON)
2. Imagem do personagem enviada como referência (para o campo `image_url` / refs)

...produz resultado visualmente fiel o suficiente para thumbnails de jogos.

### Fluxo técnico

```
1. Frontend: usuário clica "personagem custom" → upload da imagem
2. Backend: chama GPT-4o Vision com a imagem
3. Vision retorna descrição estruturada do personagem
4. Sistema usa a descrição como characters.primary.identity no JSON
5. Imagem do personagem entra como referência adicional no fal.ai payload
6. Nano Banana gera a thumb com o personagem customizado
```

### Prompt para o Vision (extração de descrição)

```
Analyze this character image and provide a detailed visual description for use in an AI image generation prompt. Focus on:
- Character type and overall silhouette
- Colors and materials (clothing, skin, armor, etc.)
- Key distinctive features (head shape, accessories, weapons, etc.)
- Art style (cartoonish, realistic, stylized, etc.)
- Any notable visual elements that make this character unique

Return a single dense paragraph (max 80 words) in the format:
"[Character type]: [description]"

Example format: "A red armored knight with golden shoulder pads, glowing blue eyes, cracked visor helmet, heavy boots with glowing trim, and a large fractured sword — stylized 3D game character with strong silhouette readability"
```

### Integração com o buildPrompt

Quando `characters.primary.type === "custom"`, o buildPrompt:
1. Usa `characters.primary.vision_description` como `identity`
2. Adiciona a imagem do personagem ao array de referências do fal.ai payload

```typescript
// buildPrompt output para personagem custom
characters: {
  primary: {
    identity: visionDescription, // gerado pelo GPT-4o
    pose: processedPose,
    position: "dominant foreground, large scale"
  }
}

// fal.ai payload
{
  prompt: JSON.stringify(finalPromptJson),
  image_url: [
    ...clusterReferenceImages, // 11-14 refs do cluster
    customCharacterImageUrl    // imagem do personagem custom
  ]
}
```

### Limitação conhecida e comunicação ao usuário

**Fidelidade não é garantida.** O Nano Banana vai gerar uma interpretação do personagem, não uma cópia. Para personagens muito complexos ou detalhados, pode sair diferente do esperado.

A UI deve comunicar isso claramente: *"O resultado é uma interpretação artística do seu personagem no estilo Fortnite — pode variar do original."*

### Custo

1 chamada GPT-4o Vision (extração) + 1 chamada Nano Banana 2 (geração) = ~$0.10-0.18 total.

---

## 4. Resumo de Implementação

| Feature | Componentes novos | Custo por uso | Dependências |
|---|---|---|---|
| Edição com brush | Canvas brush UI + máscara export | ~$0.08-0.15 | Nano Banana (já existe) |
| Troca de personagem | Mesmo brush + dropdown skins | ~$0.08-0.15 | Nano Banana (já existe) |
| Personagem custom | Upload UI + Vision call + ref inject | ~$0.10-0.18 | Vision (GPT-4o) + Nano Banana |

### Sequência recomendada de implementação

1. **Feature 3 primeiro** — Personagem custom é a mais independente. Não precisa de brush, só upload + Vision + geração normal. Menos risco de UI complexa.
2. **Feature 1** — Edição com brush. Valida o mecanismo de máscara.
3. **Feature 2** — Troca de personagem. Reusa o brush da Feature 1, só muda o prompt.

### O que NÃO foi incluído neste PRD

Overlay de texto foi descartado deliberadamente. O TGIS é um sistema de geração de thumbnails, não um editor de imagens. Adicionar texto é responsabilidade de ferramentas externas (Canva, Photoshop). Virar o Photoshop não é o objetivo.

---

## 5. Contexto da Arquitetura de Prompt (Para Referência do Codex)

### Por que o prompt é enxuto

As 11-14 imagens de referência do cluster já ensinam visualmente ao Nano Banana 2:
- O estilo visual Fortnite do cluster específico
- Composição, profundidade, paleta dominante
- Elementos característicos do cluster (tycoon tem coins, combat tem armas, etc.)

Prompt pesado com template compete com as refs e perde — o modelo pesa visual mais que texto. Prompt enxuto deixa o user_intent aparecer dentro do contexto visual que as refs estabelecem.

### Estrutura aprovada do buildPrompt

```json
{
  "user_intent": "[prompt do usuário reescrito e melhorado]",
  "characters": {
    "primary": {
      "identity": "[skin description ou vision_description para custom]",
      "pose": "[extraído e melhorado do intent]",
      "position": "dominant foreground, large scale"
    },
    "secondary": {
      "identity": "[só presente se 2 skins]",
      "pose": "[extraído do intent]",
      "position": "secondary foreground or midground"
    }
  },
  "camera": "[opção de câmera escolhida pelo usuário]",
  "mood": "[mood do cluster ou escolhido pelo usuário]",
  "constraints": {
    "technical": "no text, no titles, no numbers, no logos, no UI overlays, no HUD elements, 16:9 widescreen 1920x1080",
    "epic_policy": "EPIC GAMES CONTENT POLICY - MANDATORY COMPLIANCE: Absolutely no real-world currency: no dollar bills, no banknotes, no paper money, no currency symbols ($, EUR, GBP, BRL, JPY) of any kind. No V-Bucks symbols or Battle Pass references. No XP text, numbers, or progress bar UI elements. No Epic Games logos, product names, or branded assets. No console controller buttons (A/B/X/Y, L2/R2, triggers). No photographs or realistic depictions of real people. No alcohol bottles, drug paraphernalia, or gambling equipment. No violent gore, realistic blood, or disturbing imagery. No sexually suggestive poses or content. No URLs, social media handles, or external references. Stylized in-game gold coins are acceptable. Real-world banknotes and currency symbols are not."
  }
}
```

O campo `secondary` só existe se o usuário adicionou um segundo skin. Em gerações sem skin (`characters = 0`), o campo `identity` é `"generic Fortnite character, no fixed skin"`.

---

**Documento criado em:** 2026-03-04
**Baseado nas sessões de:** 2026-03-02 e 2026-03-04
