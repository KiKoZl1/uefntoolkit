# TGIS — Camera Control PRD v1.1
## Controle de Câmera 3D Pós-Geração

**Data:** 2026-03-04
**Owner:** Denny
**Status:** Pronto para Implementação
**Contexto:** Epic Insight Engine / Surprise Radar — TGIS

---

## 0. Contexto e Decisões que Levaram a Este PRD

### O problema que essa feature resolve

O TGIS hoje pede ao usuário para escolher o ângulo de câmera ANTES de gerar. O usuário escolhe "low angle" ou "eye level" sem ver como vai ficar, gera, não gostou da câmera, gera de novo. Cada re-geração custa ~$0.08-0.15 no Nano Banana 2.

A feature de controle de câmera inverte essa ordem: o usuário gera uma thumb, gosta da composição, personagem e ambiente, mas quer ajustar o ângulo. Ele orbita um gizmo 3D até encontrar a perspectiva certa e clica em Gerar uma única vez. Zero custo durante a exploração, um custo só na decisão final.

### Como a feature foi descoberta

Durante uma sessão de testes, foi identificado o Space do HuggingFace `linoyts/Qwen-Image-Edit-Angles` — um demo de controle de câmera 3D para imagens usando o modelo Qwen-Image-Edit. O controle 3D interativo (gizmo com handles para rotação, tilt e zoom) permitia orbitar a câmera ao redor da imagem e re-gerar de qualquer ângulo sem perda de fidelidade ou alucinação.

O Space usava Qwen-Image-Edit-2509 Lightning (4 steps). O fal.ai tem o mesmo modelo em versão 2511 (mais recente, melhor consistência) via `fal-ai/qwen-image-edit-2511-multiple-angles`.

### Teste de viabilidade realizado

Testado diretamente no fal.ai com a thumb de horror gerada pelo TGIS:

| Métrica | Resultado |
|---|---|
| Tempo de geração | **7.04 segundos** |
| Custo | **$0.035/megapixel** |
| Custo real 1920x1080 | **~$0.07 por ajuste** |
| Steps usados | 8 (Lightning) |

### Descoberta crítica: valores são contínuos, não discretos

O fal.ai aceita qualquer valor de ângulo — 37°, 73°, qualquer grau de 1 em 1. O modelo interpola entre as poses de treino. Não existem posições fixas ou snap points. O usuário tem controle preciso e contínuo dos 3 eixos, exatamente como testado no site do fal.ai.

Isso simplifica toda a implementação — não há mapeamento de ângulo para descriptor de texto, não há lógica de snap, não há grid magnético. O valor exato em graus vai direto para a API.

### O modelo: Qwen-Image-Edit-2511

- **Versão:** 2511 (Dezembro 2025) — versão mais recente
- **Melhoria sobre 2509:** melhor consistência de personagem, menos drift, LoRA capabilities integradas nativamente incluindo controle de viewpoint
- **Endpoint fal.ai:** `fal-ai/qwen-image-edit-2511-multiple-angles`
- **Steps recomendados:** 8 (Lightning) — sweet spot velocidade/qualidade
- **Licença:** Apache 2.0

### Por que não usar pod próprio

O modelo é Apache 2.0 e tecnicamente deployável. Mas o custo de idle de uma A100/H100 ($2-4/hora) não justifica no early stage. A experiência com RunPod durante a migração do Z-Image-Turbo demonstrou o custo real de manutenção de infraestrutura própria. fal.ai resolve isso — paga só quando gera.

---

## 1. Sistema de Câmera — Valores Contínuos

### Os 3 Eixos e seus Limites Confirmados

**Azimuth — rotação horizontal**
Valor contínuo de **-90° a +90°**. Qualquer grau é válido.
```
-90°──────────────── 0° ────────────────+90°
esquerda           frente            direita
(left side)      (front view)      (right side)
```

**Elevation — ângulo vertical**
Valor contínuo de **-30° a +60°**. Qualquer grau é válido.
```
+60° = câmera alta, olhando para baixo (god view)
+30° = elevated
  0° = eye-level
-30° = câmera baixa, olhando para cima (heroic)
```

**Distance — zoom**
Valor contínuo de **0.5 a 1.5**.
```
0.5 = close-up máximo (rosto, detalhe)
1.0 = medium shot (neutro, padrão)
1.5 = wide shot máximo (ambiente completo)
```

### Por que back views são bloqueadas

O azimuth é limitado a ±90° intencionalmente — qualquer ângulo além disso coloca a câmera atrás do personagem, quebrando a composição. Thumbs de Fortnite sempre têm o personagem olhando para o viewer ou em 3/4. UX mais segura — o usuário não chega em poses que vão gerar resultado ruim.

---

## 2. A Feature: Gizmo 3D de Câmera

### O que é

Um controle 3D interativo. A thumb gerada aparece mapeada como textura num plano 3D no centro da cena. O usuário orbita a câmera virtual ao redor dela com três handles coloridos:

- **Handle verde (arco horizontal)** → Azimuth — rotação lateral
- **Handle rosa (arco vertical)** → Elevation — ângulo de cima/baixo
- **Handle amarelo (linha)** → Distance — zoom

Enquanto o usuário move os handles, o gizmo se move em tempo real. Um label exibe os valores exatos:

```
Rotation: 37°  |  Tilt: -12°  |  Zoom: 0.8
```

Quando o usuário clicar em **"Gerar com esse ângulo"**, uma única chamada é feita ao fal.ai com os valores exatos.

### O que NÃO é

Não é preview da imagem gerada em tempo real. Não há chamadas de API durante a interação com o gizmo — zero custo durante a exploração. O único custo ocorre quando o usuário confirma a geração.

### Por que esse design

Com 7 segundos de latência, preview em tempo real durante o drag seria inviável. O gizmo como "seletor visual de ângulo" resolve isso: feedback visual instantâneo durante a exploração (Three.js a 60fps), custo zero, e uma geração deliberada no clique.

---

## 3. Implementação Técnica

### Stack

- **Three.js** — gizmo 3D, OrbitControls, textura da thumb no PlaneGeometry
- **React** — componente wrapper, state management
- **fal.ai** — `fal-ai/qwen-image-edit-2511-multiple-angles`
- **Webhook existente** — o mesmo sistema de webhook do TGIS recebe o resultado

### Componente Three.js

```typescript
const CameraGizmo = ({ thumbUrl, onGenerate }) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 16/9, 0.1, 100);

  // Thumb como textura no plano central
  const texture = new THREE.TextureLoader().load(thumbUrl);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 9),
    new THREE.MeshBasicMaterial({ map: texture })
  );
  scene.add(plane);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;

  // ─── LIMITES CONFIRMADOS ────────────────────────────────────────────────────

  // AZIMUTH: -90° a +90° — hemisfério frontal, back views bloqueados
  controls.minAzimuthAngle = -Math.PI / 2;
  controls.maxAzimuthAngle =  Math.PI / 2;

  // ELEVATION: -30° a +60°
  // Three.js: polar angle onde 90° = horizonte
  controls.minPolarAngle = Math.PI / 2 - (60 * Math.PI / 180); // +60° elevation
  controls.maxPolarAngle = Math.PI / 2 + (30 * Math.PI / 180); // -30° elevation

  // DISTANCE: 0.5 a 1.5
  controls.minDistance = 0.5;
  controls.maxDistance = 1.5;

  // ────────────────────────────────────────────────────────────────────────────

  // Estado contínuo — sem snap, sem poses fixas
  const [cameraState, setCameraState] = useState({
    azimuth: 0,    // graus exatos, -90 a +90
    elevation: 0,  // graus exatos, -30 a +60
    distance: 1.0  // valor exato, 0.5 a 1.5
  });

  // Atualiza label a cada frame — valores contínuos em tempo real
  controls.addEventListener('change', () => {
    const azimuthDeg   = Math.round(controls.getAzimuthalAngle() * 180 / Math.PI);
    const elevationDeg = Math.round((Math.PI / 2 - controls.getPolarAngle()) * 180 / Math.PI);
    const dist         = Math.round(camera.position.length() * 10) / 10;
    setCameraState({ azimuth: azimuthDeg, elevation: elevationDeg, distance: dist });
  });
};
```

### Label em tempo real

```tsx
// Valores exatos — sem descritores de texto como "front-right quarter view"
<div className="camera-label">
  Rotation: {cameraState.azimuth}°
  &nbsp;|&nbsp;
  Tilt: {cameraState.elevation}°
  &nbsp;|&nbsp;
  Zoom: {cameraState.distance}
</div>
```

### Chamada fal.ai — valores contínuos direto na API

```typescript
const generateWithAngle = async (thumbUrl: string, cameraState: CameraState) => {
  const result = await fal.subscribe('fal-ai/qwen-image-edit-2511-multiple-angles', {
    input: {
      image_url: thumbUrl,
      azimuth:   cameraState.azimuth,    // ex: 37 (grau exato)
      elevation: cameraState.elevation,  // ex: -12 (grau exato)
      distance:  cameraState.distance,   // ex: 0.8
      num_inference_steps: 8,            // Lightning — 7s de latência
      lora_strength: 0.9,
    },
    onQueueUpdate: (update) => {
      // atualiza loading state
    }
  });
  return result.images[0].url;
};
```

### UX Flow completo

```
1. Usuário gera thumb normalmente via TGIS
2. Thumb aparece com botão "Ajustar Câmera"
3. Usuário clica → abre modal com gizmo 3D
4. Thumb mapeada no plano central da cena 3D
5. Usuário arrasta os handles livremente (zero latência, 60fps)
6. Label atualiza valores exatos em tempo real: "Rotation: 37° | Tilt: -12° | Zoom: 0.8"
7. Usuário clica "Gerar com esse ângulo"
8. Loading state (7s) — thumb original ainda visível
9. Nova thumb aparece com o ângulo ajustado
10. Usuário pode: aceitar / tentar outro ângulo / voltar ao original
```

---

## 4. Presets de Câmera para Thumbs de Fortnite

Atalhos rápidos acima do gizmo. O usuário clica no preset, o gizmo pula para aquela posição, e pode refinar antes de gerar.

| Preset | Azimuth | Elevation | Distance | Melhor para |
|---|---|---|---|---|
| **Heroic** | 0° | -25° | 1.0 | Personagem dominante, tycoon, boss |
| **Confronto** | 0° | 0° | 1.0 | 1v1, duelo direto |
| **Epicidade** | 35° | -25° | 0.7 | Ação intensa, close dramático |
| **Overview** | 0° | 45° | 1.4 | Ambiente rico, tycoon com cidade |
| **Cinematic** | -30° | -20° | 0.9 | Horror, thriller, suspense |
| **God View** | 0° | 60° | 1.5 | Mapas, múltiplos personagens |

---

## 5. Custo e Billing

**Por ajuste de câmera:**
- 1920 × 1080 = 2.07 megapixels × $0.035 = **~$0.07**

**Comparação:**
- Re-gerar do zero no Nano Banana 2: ~$0.08-0.15
- Pod próprio (A100 idle): $2-4/hora independente de uso

**Modelo de cobrança para o usuário:**
Cobrar 50% de uma geração completa — mais barato que re-gerar e entrega valor real.

---

## 6. O que Esta Feature Não Faz

**Não substitui a seleção de câmera na geração inicial — os botões de câmera do frontend NÃO devem ser removidos.**

```
[FLUXO ORIGINAL — não muda nada]
Usuário escolhe câmera via botões no frontend
        ↓
Camera vai para buildPrompt → Nano Banana
        ↓
Nano Banana RENDERIZA a cena com aquela perspectiva
        ↓
Thumb gerada

[FLUXO NOVO — refinamento opcional depois]
Usuário quer outro ângulo na thumb gerada?
        ↓
Gizmo 3D do Qwen re-renderiza do ângulo escolhido
```

| | Câmera 1 (buildPrompt) | Câmera 2 (Qwen) |
|---|---|---|
| **Quando** | Antes de gerar | Depois de gerar |
| **O que faz** | Define perspectiva da cena | Re-renderiza de outro ângulo |
| **Modelo** | Nano Banana 2 | Qwen-Image-Edit-2511 |
| **UI** | Botões existentes no frontend | Gizmo 3D novo |
| **Obrigatório** | Sim — sem isso não há thumb | Não — refinamento opcional |

Remover os botões de câmera do frontend quebraria o fluxo inteiro.

**Não é editor de composição.** Não permite mover personagens ou recompor cena — isso é escopo do Edit Mode com brush (TGIS_EDIT_MODE_PRD_v1.md).

**Não garante fidelidade 100%.** Pequenas variações de textura e iluminação são esperadas. Composição geral e personagens são preservados com alta fidelidade pelo 2511.

**⚠️ Testar antes de produção — limite de resolução do Qwen:** O modelo tem limite de 1 megapixel de entrada. Nossa thumb é 1920×1080 = 2.07 megapixels. Verificar o que acontece ao enviar — pode redimensionar automaticamente, degradar qualidade ou retornar erro. Se necessário, redimensionar para ~1280×720 antes de enviar ao Qwen.

---

## 7. Sequência de Implementação

**Fase 1 — Integração fal.ai sem UI 3D**
Três sliders simples (azimuth, elevation, distance) com os limites confirmados. Valida integração, custo, webhook e qualidade dos resultados antes de investir no Three.js.

**Fase 2 — Gizmo 3D**
Componente Three.js com os 3 handles coloridos. Label de valores contínuos em tempo real. Limites via OrbitControls. Botão de confirmação.

**Fase 3 — Presets rápidos**
6 presets de Fortnite como atalhos visuais acima do gizmo.

---

**Documento criado em:** 2026-03-04
**Versão:** v1.1 — valores contínuos (atualizado de v1.0 que usava 96 poses discretas)
**Modelo validado:** fal-ai/qwen-image-edit-2511-multiple-angles · 8 steps · $0.035/megapixel · 7.04s
