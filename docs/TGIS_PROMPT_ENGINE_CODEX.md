# TGIS — Prompt Engine: Diagnóstico Completo & Plano de Correção
**Para o Codex — 2026-03-03**

---

## Contexto

O TGIS usa o Nano Banana 2 (`fal-ai/nano-banana-2/edit`) como motor de geração. O sistema recebe campos do usuário, constrói um prompt via `buildPrompt` em `supabase/functions/tgis-generate/index.ts`, monta um array de imagens de referência e envia tudo para o modelo. A geração já funciona e entrega qualidade comercial.

Foram identificados **4 problemas críticos** no pipeline de construção do prompt que afetam qualidade, consistência e compliance com as guidelines obrigatórias da Epic Games.

---

## Resumo dos 4 Problemas

| # | Problema | Severidade |
|---|----------|------------|
| P1 | Personagem B genérico injetado quando usuário não seleciona skin 2 | Alta |
| P2 | Nenhum cluster tem template — sistema usa fallback genérico em 100% dos requests | Alta |
| P3 | Descrição do usuário é um bloco isolado que briga com o template em vez de se integrar | Alta |
| P4 | Violações das guidelines obrigatórias da Epic (moeda real, XP, etc.) | Crítica |

---

## P1 — Personagem B Genérico Injetado Sem Necessidade

### O que está errado hoje

Quando o usuário seleciona apenas 1 skin (ou nenhuma), o `buildPrompt` ainda injeta um Character B genérico:

```
Character B = a Fortnite character as the opposing/supporting subject.
Keep Character A as the dominant foreground subject and Character B as
the clear opposing/supporting subject with readable action.
```

O Nano Banana inventa um personagem aleatório. Na geração de exemplo, saiu Peely — o usuário não pediu segundo personagem. O modelo está alucinando um personagem que não deveria existir.

### Regra correta

| Skins selecionadas | Comportamento esperado |
|---|---|
| 0 skins | Nenhum personagem nomeado. Template usa linguagem genérica se o cluster exigir sujeito. |
| 1 skin | Somente Character A injetado. Bloco de Character B **suprimido completamente**. |
| 2 skins | Character A + Character B. Comportamento atual (correto para este caso). |

### Solução — Lógica condicional no buildPrompt

Localizar o bloco "Character and placement" na função `buildPrompt` e refatorar para:

```typescript
let characterBlock = '';

if (skins.length >= 1) {
  characterBlock += `Character A = ${skins[0].name}: ${skins[0].visionDescription}.`;
}

if (skins.length >= 2) {
  // Só injeta Character B se o usuário selecionou 2 skins
  characterBlock += ` Character B = ${skins[1].name}: ${skins[1].visionDescription}.`;
  characterBlock += ` Keep Character A dominant foreground, Character B supporting.`;
} 
// skins.length === 1: só Character A, sem Character B, sem texto de relação
// skins.length === 0: nenhum personagem nomeado
```

**Caso especial para clusters de 2 personagens (1v1, boxfight) com apenas 1 skin:** usar `"another player"` como sujeito secundário — sem descrição de skin, sem nome, sem identidade.

---

## P2 — Nenhum Cluster Tem Template de Prompt

### O que está errado hoje

O código carrega o template do cluster da tabela `tgis_prompt_templates`. Se não encontrar template ativo, cai no `defaultClusterTemplate` — um texto genérico que não conhece a composição visual de nenhum cluster específico.

**Estado atual da tabela `tgis_prompt_templates`: zero registros com template validado.** Todos os requests estão usando o fallback.

O resultado: a qualidade depende inteiramente da descrição do usuário. Se o usuário descrever bem, sai bem. Se descrever pouco, sai genérico.

### Por que templates importam

O Nano Banana usa as imagens de referência do cluster para aprender o estilo visual, mas precisa do prompt para saber a **composição**. Sem template, o modelo recebe 13 refs de tycoon mas um prompt genérico — ele pode gerar qualquer coisa no estilo tycoon, não a composição correta do gênero.

Com template: composição exata do gênero + refs visuais = os dois juntos multiplicam a qualidade.

### Solução — Gerar templates via Vision nas top thumbs de cada cluster

**Processo (não inventar templates manualmente — usar dados reais):**

**Passo 1:** Para cada cluster ativo, buscar as **top 20 thumbs** por `quality_score DESC` da tabela `tgis_reference_images`.

**Passo 2:** Para cada uma das 20 thumbs, chamar OpenRouter Vision (já usado para skin vision — reusar a mesma infra) com este prompt específico:

```
Describe ONLY the composition and visual structure of this Fortnite
Creative thumbnail. Focus on:
- Foreground: what is positioned here, approximate size relative to frame
- Midground: what elements appear here
- Background: environment type, setting
- Color palette: dominant colors and mood
- Camera angle: low/eye/high
- Composition style: diagonal, centered, rule of thirds, etc.

Do NOT describe characters, skins, text, or specific objects.
Do NOT mention anything you see in the image specifically.
Respond in 4-6 sentences, purely structural and compositional.
Be concise and objective.
```

**Passo 3:** Com as 20 descrições do cluster, fazer uma segunda chamada pedindo ao modelo para sintetizar o padrão dominante em uma instrução de composição de 3-4 linhas. Esse output é o `base_direction` do template.

**Passo 4:** Complementar o `base_direction` com os campos fixos de câmera, mood e slots de personagens (`[PERSONAGEM_1]`, `[PERSONAGEM_2]`).

**Passo 5:** Inserir na tabela `tgis_prompt_templates` com `cluster_slug`, `is_active = true`, `version = 'v1_generated'`.

### Prioridade de clusters

| Cluster | Prioridade | Observação |
|---|---|---|
| tycoon | ALTA | Maior volume de requests |
| 1v1 / pvp / boxfight | ALTA | Template já testado em sessão anterior — atualizar para nova arquitetura, não copiar direto |
| horror | MÉDIA | |
| deathrun / parkour | MÉDIA | |
| roleplay / simulator | BAIXA | Refinar após os anteriores |

### Sobre o template de 1v1 existente

Um template de 1v1 foi testado em 4 iterações em sessão anterior e está documentado no `TGIS_NANO_BANANA_ARCHITECTURE.md`. Porém, foi criado sem ângulo de câmera condicional, sem mood, sem preprocessamento da descrição do usuário. **Precisa ser revalidado e atualizado para a arquitetura atual** — não apenas copiado para o banco.

---

## P3 — Descrição do Usuário Briga Com o Template

### O que está errado hoje

O `buildPrompt` trata a descrição do usuário como um bloco independente concatenado ao prompt:

```
// Estrutura atual do buildPrompt:
1. Base direction        (template do cluster)
2. Character and placement
3. Camera direction
4. Mood and atmosphere
5. User creative intent  ← bloco isolado, simplesmente concatenado
6. Map context           ← título cru do mapa, injetado direto no prompt de imagem
7. Tag context
8. Reference mapping
9. Reference policy
10. Composition rules
11. Hard constraints
```

O resultado: o modelo recebe duas direções composicionais conflitantes.

**Template diz:** `"Strong hero framing in foreground with progression-rich background"`

**Usuário diz:** `"smiling character surrounded by giant golden coins, shop counters and upgrade icons floating, diagonal composition"`

O modelo recebe ambos e chuta uma interpretação. Às vezes funciona, às vezes um bloco cancela o outro.

**Problema adicional:** O título do mapa (`"Escape lava From Brainrot"`) é injetado literalmente como `Map context` no prompt de imagem. O modelo de imagem não sabe o que fazer com o título de um mapa — contamina a geração com semântica irrelevante.

### Por que o preprocessador não foi implementado

A arquitetura `TGIS_NANO_BANANA_ARCHITECTURE.md` planejava usar Gemini Flash via OpenRouter como preprocessador automático da descrição do usuário. **Esse preprocessamento nunca foi implementado.** O que existe hoje é só o Rewrite (botão "Melhorar") que é opcional e diferente — o Rewrite melhora a escrita do usuário, não estrutura os elementos visuais para injeção no template.

### Solução — Implementar preprocessador de intent via OpenRouter

Adicionar uma chamada ao OpenRouter **antes** do `buildPrompt`. Essa chamada **não é opcional nem visível ao usuário** — acontece automaticamente em todo request de geração.

**Criar função:** `processUserIntent(userDescription, mapTitle, tags, clusterSlug)`

**System prompt do preprocessador:**

```
You are a visual composition assistant for Fortnite Creative thumbnails.
Extract structured visual elements from the user's description.

IMPORTANT COMPLIANCE RULE: If the user mentions real-world currency 
(dollar bills, banknotes, cash, paper money, $ symbol), automatically 
replace with in-game equivalents (gold coins, treasure, rewards, loot).
Never include real-world currency in your output.

Return ONLY a JSON object with these fields:
{
  "main_subject_action": "what the main character is doing",
  "environment_elements": ["element1", "element2", "element3"],
  "composition_style": "diagonal/centered/rule-of-thirds/etc",
  "color_emphasis": "dominant colors and contrasts",
  "character_pose": "pose/expression description",
  "depth_layers": "foreground / midground / background description"
}

Input context:
- Map title: [MAP_TITLE] (use only for environment inference, never output literally)
- Tags: [TAGS]
- Cluster: [CLUSTER_SLUG]
- User description: [USER_DESCRIPTION]
```

**Como os campos estruturados são usados:**

Os campos do preprocessador são injetados nos **slots corretos** do template — não como bloco separado:

```
// ANTES (atual — conflito):
[Template base] + [bloco User creative intent isolado]

// DEPOIS (correto — integrado):
Template com slots preenchidos pelo preprocessador:
"[PERSONAGEM_1] large in foreground, [character_pose from preprocessor].
[environment_elements[0]] in foreground. Background shows [environment_elements[1..n]].
[composition_style] composition, [color_emphasis] palette."
```

**Sobre o Map context (título do mapa):**
- O título **nunca** vai direto para o prompt do Nano Banana
- Vai como input para o preprocessador apenas, para inferir `environment_elements`
- O título em si nunca aparece no prompt final

**Custo:** ~$0.001-0.002 por request via OpenRouter (modelo barato). Latência adicional: ~400-600ms antes da chamada ao Nano Banana.

**Observabilidade:** Salvar o output do preprocessador em um campo `processed_intent` no `tgis_generation_log` para debug.

---

## P4 — Violações das Guidelines Obrigatórias da Epic Games

### O que está errado hoje

A thumbnail de exemplo gerada contém **notas de dólar ($)** — moeda real. Isso viola diretamente a **Regra 1.13.2 da Epic:**

> *"Do not mention V-Bucks, Battle Pass, real-world currency, or rewards."*
> — Fortnite Island Creator Rules + Creator Marketing Playbook

O problema não está no usuário ter pedido "cash bills" — o sistema deveria bloquear isso independentemente. As guidelines são obrigação do criador de conteúdo. Uma thumbnail violando as regras pode resultar em **rejeição do mapa ou remoção do Discover**.

### Lista completa de proibições confirmadas pela Epic

| Proibido | Regra |
|---|---|
| Notas de dólar, papel moeda, símbolos $ | 1.13.2 — **a thumb de exemplo atual viola isso** |
| V-Bucks, símbolos de V-Bucks | 1.13.2 |
| Battle Pass, passe de batalha | 1.13.2 |
| XP, barras de experiência, ganho de XP | 1.13.3 e 1.13.1 |
| Logos da Epic Games, nomes de produtos Epic | Guideline de IP |
| Botões de controle de console (A/B/X/Y, L2/R2) | Guideline técnica |
| Imagens de pessoas reais | 1.2 (privacidade) |
| Conteúdo não disponível/interagível na ilha | 1.13 (autenticidade) |
| Álcool, drogas | 1.15.4 |
| Gambling, cassino, jogos de azar | 1.11 e 1.15.5 |
| Violência realista, gore, sangue vermelho | 1.15.1 |
| Nudez, temas sexualmente sugestivos | 1.15.3 |
| URLs, QR codes, redes sociais externas | 1.12 |

> **Nota:** moedas de ouro estilizadas (in-game currency do Creative) são **permitidas**. O que é proibido é moeda real — notas, papel moeda, símbolos de moeda nacional ($, €, R$).

### Solução — Bloco EPIC_POLICY_CONSTRAINTS fixo em todo prompt

Adicionar o seguinte bloco **imutável** após as Hard constraints atuais no `buildPrompt`. Este bloco **nunca pode ser removido, sobrescrito ou ignorado** por nenhuma lógica:

```
EPIC GAMES CONTENT POLICY — MANDATORY COMPLIANCE:
Absolutely no real-world currency: no dollar bills, no banknotes,
no paper money, no currency symbols ($, €, £, R$, ¥) of any kind.
No V-Bucks symbols or Battle Pass references.
No XP text, numbers, or progress bar UI elements.
No Epic Games logos, product names, or branded assets.
No console controller buttons (A/B/X/Y, L2/R2, triggers).
No photographs or realistic depictions of real people.
No alcohol bottles, drug paraphernalia, or gambling equipment.
No violent gore, realistic blood, or disturbing imagery.
No sexually suggestive poses or content.
No URLs, social media handles, or external references.
Stylized in-game gold coins are acceptable.
Real-world banknotes and currency symbols are not.
```

Este bloco deve ser a **última coisa** no prompt, após todas as outras seções.

---

## Plano de Implementação

Ordem de execução — P4 entra **antes de qualquer teste com usuários reais**:

### Etapa 1 — P4: Epic Policy Constraints (CRÍTICA, implementar primeiro)

1. Em `supabase/functions/tgis-generate/index.ts`, localizar a função `buildPrompt`.
2. Após o bloco de Hard constraints, adicionar o bloco `EPIC_POLICY_CONSTRAINTS` como constante imutável.
3. Garantir que este bloco é **sempre o último** bloco de texto do prompt.
4. Testar com prompt intencionalmente violador (ex: "dollar bills everywhere") e confirmar no `tgis_generation_log` → campo `prompt_rewritten` que o bloco de policy está presente.
5. Gerar imagem com esse prompt e confirmar que notas de dólar não aparecem.

### Etapa 2 — P1: Lógica Condicional de Personagens

1. Localizar o bloco "Character and placement" no `buildPrompt`.
2. Refatorar para lógica condicional conforme pseudocódigo da seção P1.
3. Testar com 0 skins → confirmar que nenhum Character A/B aparece no prompt.
4. Testar com 1 skin → confirmar que só Character A aparece, sem Character B.
5. Testar com 2 skins → confirmar comportamento atual mantido.
6. Verificar no `tgis_generation_log` → campo `slots_json` os 3 casos.

### Etapa 3 — P3: Preprocessador de Intent via OpenRouter

1. Criar função `processUserIntent(userDescription, mapTitle, tags, clusterSlug)` no `tgis-generate`.
2. Chamada ao OpenRouter com system prompt documentado na seção P3.
3. Retorno é JSON estruturado com os 6 campos.
4. Refatorar `buildPrompt` para aceitar `processedIntent` como parâmetro e injetar os campos nos slots do template.
5. Remover o bloco `Map context` do prompt final (título do mapa vai só para o preprocessador).
6. Substituir o bloco `User creative intent` isolado pela intent já integrada no template.
7. Adicionar campo `processed_intent` no `tgis_generation_log`.
8. Testar e confirmar que o `prompt_rewritten` não contém mais "Map context:" como bloco separado.

### Etapa 4 — P2: Geração de Templates por Cluster via Vision

1. Criar script para rodar o pipeline de vision por cluster (pode ser chamada direta ao OpenRouter via script JS/Python, reutilizando a infra de vision já existente).
2. Para cada cluster ativo: buscar top 20 thumbs por `quality_score DESC` de `tgis_reference_images`.
3. Para cada thumb: chamar OpenRouter Vision com o prompt de análise composicional documentado na seção P2. **Não usar o mesmo prompt do skin vision.**
4. Com as 20 respostas: chamada de síntese para extrair `base_direction` (3-4 linhas).
5. Montar template completo: `base_direction` + slots de personagens + câmera + mood + restrições.
6. Inserir em `tgis_prompt_templates` com `is_active = true`, `version = 'v1_generated'`.
7. Ordem: tycoon → 1v1 → horror → deathrun → demais.
8. Para cada template inserido: rodar 3 gerações de teste e avaliar visualmente antes de marcar como produção.

---

## Checklist de Conclusão

O TGIS está pronto para usuários reais quando todos os itens abaixo estiverem marcados:

**P4 — Epic Guidelines**
- [ ] Bloco `EPIC_POLICY_CONSTRAINTS` presente em **todo** prompt gerado (verificar no `tgis_generation_log`)
- [ ] Prompt com "dollar bills" → geração sem notas de dólar confirmada visualmente
- [ ] Prompt com "V-Bucks" → nenhum símbolo V-Bucks na imagem gerada

**P1 — Personagens**
- [ ] 0 skins → prompt não contém nenhum Character A ou B nomeado
- [ ] 1 skin → prompt contém Character A, não contém Character B
- [ ] 2 skins → Character A e Character B presentes (comportamento atual mantido)

**P3 — Preprocessador**
- [ ] `processUserIntent()` chamado em todo request antes do `buildPrompt`
- [ ] Título do mapa **não aparece** no prompt do Nano Banana
- [ ] Bloco `User creative intent` isolado removido — intent integrada no template
- [ ] `processed_intent` salvo no `tgis_generation_log`

**P2 — Templates**
- [ ] tycoon: template em `tgis_prompt_templates` com `is_active = true`
- [ ] 1v1: template atualizado para nova arquitetura e validado
- [ ] horror: template gerado e testado
- [ ] deathrun/parkour: template gerado e testado
- [ ] `defaultClusterTemplate` atualizado como fallback melhorado para clusters sem template

---

*TGIS Prompt Engine — Epic Insight Engine — 2026-03-03*
