# Surprise Radar — Thumbnail Generation Intelligence System (TGIS)
## PRD Final v1.0 — Documento Completo de Implementação

**Data:** 2026-02-27
**Owner:** Denny
**Status:** Aprovado para Implementação
**Plataforma:** Epic Insight Engine / Surprise Radar

---

## 0. Executive Summary

O Surprise Radar já possui o maior banco de dados privado de thumbnails de Fortnite Creative do mundo: aproximadamente 90.000 imagens coletadas continuamente via API da Epic, associadas a métricas reais de performance — CCU, tempo em painel, resultados de testes A/B, trocas de thumbnail, categoria e tags. Nenhum outro sistema público ou privado possui essa combinação.

O TGIS (Thumbnail Generation Intelligence System) é a camada que transforma esse acervo em vantagem competitiva direta para criadores: um gerador de thumbnails especialista, treinado para produzir imagens no estilo visual que o algoritmo do Discovery da Epic historicamente coloca nos painéis de maior alcance.

O sistema usa LoRAs (Low-Rank Adapters) treinados por cluster de categoria em cima do Z-Image-Turbo — o modelo de geração de imagens mais eficiente da categoria, com suporte nativo a fine-tuning via AI Toolkit do ostris.

### Stack de implementação

| Componente | Tecnologia | Função |
|---|---|---|
| Modelo base | Z-Image-Turbo (6B params) | Geração de imagens 1920x1080 |
| Fine-tuning | LoRA via AI Toolkit + ostris adapter | Especialização por cluster visual |
| Clustering | CLIP embeddings + K-Means | Agrupamento de categorias por estilo |
| Caption | GPT-4o Vision (estruturado) | Legenda de treino de cada thumbnail |
| Prompt rewrite | GPT-4o-mini via OpenRouter | Reescrita inteligente do prompt do usuário |
| Inferência | fal.ai API | Geração em produção, pay-per-use |
| Dataset | Supabase — discover_link_metadata | 90k thumbs + métricas de performance |
| Download assets | Python worker (Hetzner CX22) | Curadoria, score, download organizado |
| Frontend | Epic Insight Engine (React/TS) | Feature dentro do Surprise Radar |

**Equipe:** Solo developer + Claude Code + Codex
**Custo de treino estimado:** ~$50–60 total para todos os clusters
**Custo por geração:** ~$0.01 por set de 4 thumbnails
**Margem operacional:** ~96% em plano de $19.90/mês

---

## 1. Contexto e Problema

### 1.1 O que existe hoje

Criadores de ilhas no Fortnite Creative enfrentam um problema concreto: a thumbnail é um dos fatores mais determinantes para se destacar no Discovery, mas não existe nenhuma ferramenta especializada para criá-las. As opções atuais são:

- Contratar designer — caro, lento, depende de conhecimento do contexto do Discovery
- Usar Canva ou Photoshop — template genérico, sem dados do que performa
- Usar Midjourney ou DALL-E — modelos não treinados para Fortnite Creative especificamente
- Copiar estilo de ilhas populares — manual, subjetivo, sem garantia

### 1.2 O diferencial do TGIS

O Surprise Radar já captura, em near real-time, todos os dados de exposição do Discovery. Isso cria um dataset único que nenhum modelo público possui acesso:

- 90k+ thumbnails indexadas com métricas de performance associadas
- Histórico de testes A/B: sabemos quando um criador trocou de thumb e o impacto no CCU
- Correlação direta entre visual da thumb e entrada em painéis de alto alcance
- Dados segmentados por categoria/tag, região e painel

A pergunta que o TGIS responde não é "como gerar uma imagem bonita?" — é "como gerar uma imagem que o Discovery da Epic vai colocar no painel Popular?" Essa distinção é o núcleo de toda a arquitetura do sistema.

### 1.3 Por que o Z-Image-Turbo e não outros modelos

| Critério | Z-Image-Turbo | FLUX.1-dev | nano-banana-2 |
|---|---|---|---|
| Renderização de texto | Excelente (bilíngue) | Boa | Limitada |
| VRAM necessária | 16GB consumer | 24GB recomendado | 8GB |
| Velocidade inferência | Sub-second (8 NFEs) | ~20-50 NFEs | Rápido |
| Fine-tuning LoRA | Sim (via adapter ostris) | Sim (nativo) | Limitado |
| Estilo visual gaming | Muito bom | Bom | 2D/sprite apenas |
| Licença | Apache 2.0 | Restritiva (dev) | MIT |

O nano-banana-2 foi descartado pois é especialista em sprites 2D e não no estilo visual 3D/cinematográfico das thumbnails de Fortnite Creative. O FLUX.1-dev foi descartado pela licença mais restritiva e VRAM mais exigente.

### 1.4 O training adapter do ostris — por que é necessário

Modelos step-distilled como o Z-Image-Turbo apresentam um problema ao serem fine-tuned diretamente: a destilação (que garante geração rápida em poucos passos) se degrada rapidamente durante o treino.

O ostris (autor do AI Toolkit, ferramenta padrão para treino de LoRA) desenvolveu um training adapter específico para o Z-Image-Turbo que resolve esse problema. O adapter funciona como um "amortecedor" da destilação durante o treino: ele foi pré-treinado com milhares de imagens do próprio Z-Image-Turbo a uma taxa de aprendizado baixa, quebrando a destilação de forma controlada.

Quando você treina seu LoRA em cima desse adapter, apenas o seu estilo/conceito é aprendido — a destilação não degrada mais. Na inferência, o training adapter é removido. Seu LoRA fica aplicado ao modelo distilado original, mantendo a velocidade sub-second.

**Referências:**
- Modelo: https://huggingface.co/Tongyi-MAI/Z-Image-Turbo
- Training adapter: https://huggingface.co/ostris/zimage_turbo_training_adapter
- AI Toolkit: https://github.com/ostris/ai-toolkit

---

## 2. Objetivos

### 2.1 Objetivos primários

- Construir pipeline automatizado de curadoria e download de thumbnails a partir do Supabase
- Implementar sistema de clustering visual por categoria usando CLIP embeddings
- Treinar LoRAs especializados por cluster no Z-Image-Turbo via AI Toolkit
- Criar pipeline de geração com reescrita inteligente de prompt (GPT-4o-mini)
- Integrar a feature de geração de thumbnail no Surprise Radar como terceira ferramenta do Workspace

### 2.2 Objetivos secundários

- Retreino trimestral automático de todos os clusters com dados atualizados
- Retreino pontual por cluster quando o DPPI detectar mudança de regime
- Versionamento de LoRAs com fallback para versão anterior em caso de regressão

### 2.3 Non-goals

- Não replicar o algoritmo exato da Epic — correlação, não causalidade
- Não treinar modelo do zero — LoRA em cima do Z-Image-Turbo
- Não remover background das thumbnails geradas — Fortnite Creative usa thumbs com fundo
- Não implementar sistema de pagamento no MVP — feature aberta para usuários logados
- Não prometer que a thumbnail gerada vai entrar no Discovery — sempre comunicar que é baseado em padrões observados

---

## 3. Dados e Fontes

### 3.1 Tabelas do Supabase utilizadas

| Tabela | Campo chave | Uso no TGIS |
|---|---|---|
| `discover_link_metadata` | `image_url`, `feature_tags` | Fonte primária de thumbnails e categorias |
| `discover_link_metadata_events` | `event_type='thumb_changed'`, `old_value`, `new_value` | Dados de A/B test — thumb anterior vs nova |
| `discovery_exposure_presence_segments` | `link_code`, `panel_name`, `start_ts`, `end_ts` | Tempo de permanência em painel — sinal de qualidade |
| `discovery_exposure_rollup_daily` | `link_code`, `panel_name`, `minutes_exposed` | CCU e exposição diária — peso de score |
| `discovery_panel_intel_snapshot` | `panel_name`, `entries_24h`, `panel_avg_ccu` | Regime do painel — contexto de performance |

### 3.2 Volume e estrutura dos dados

| Métrica | Valor atual |
|---|---|
| Total de thumbnails indexadas | ~90.000 |
| Thumbnails com CCU registrado | ~75.000 |
| Thumbnails com evento A/B (thumb_changed) | ~12.000 |
| Categorias/tags distintas | 20–30 |
| Resolução padrão | 1920x1080 (16:9) |
| Formato | PNG/JPEG via CDN Epic |

### 3.3 Estrutura do campo image_url

O campo `image_url` na tabela `discover_link_metadata` já contém a URL direta e resolvida da thumbnail, processada pelo collector. A lógica de resolução prioriza, nessa ordem:

```
image_url direto > imageUrls array > extraImageUrls > tile_background_image_urls > outros campos do raw JSON
```

Para download, a URL pode ser usada diretamente sem processamento adicional.

### 3.4 Estrutura do A/B test em discover_link_metadata_events

Quando um criador troca de thumbnail, o collector detecta a diferença entre o `image_url` anterior e o novo, e insere um evento com `event_type = 'thumb_changed'`. Schema do evento:

```json
{
  "id": "BIGSERIAL",
  "ts": "TIMESTAMPTZ",
  "link_code": "TEXT",
  "event_type": "thumb_changed",
  "old_value": { "image_url": "https://..." },
  "new_value": { "image_url": "https://..." }
}
```

Para inferir o resultado do A/B test, cruzamos o `ts` do evento com os dados de `discovery_exposure_rollup_daily`: se o CCU médio nas 2 semanas após a troca for superior ao CCU médio nas 2 semanas anteriores, a nova thumb é considerada vencedora (`ab_winner = true`). Esse sinal é o mais valioso do dataset.

---

## 4. Pipeline de Curadoria e Scoring

> **CRÍTICO:** Jogar as 90k thumbnails diretamente no treino seria um erro. O modelo aprenderia ruído junto com sinal. Uma thumbnail de uma ilha com CCU 2 que nunca entrou em painel nenhum tem o mesmo volume de pixels que uma thumbnail de ilha com CCU 50k que ficou 3 horas no painel Popular — mas representam realidades completamente opostas sobre o que funciona.

### 4.1 Fórmula de scoring de qualidade

Cada thumbnail recebe um score de 0 a 1 calculado programaticamente:

| Componente | Peso | Fonte | Descrição |
|---|---|---|---|
| `ccu_percentile_within_tag` | 40% | `discovery_exposure_rollup_daily` | Percentil do CCU médio dentro da mesma tag. Normalizado 0-1. |
| `avg_stint_minutes_normalized` | 30% | `discovery_exposure_presence_segments` | Tempo médio de permanência em painel, normalizado pelo P90 da tag. |
| `ab_winner_bonus` | 20% | `discover_link_metadata_events` + `rollup_daily` | 1.0 se thumb vencedora no A/B; 0.5 se manteve; 0.0 se não houve troca. |
| `panel_tier_score` | 10% | `discovery_panel_intel_snapshot` | 0-1 baseado no tier do painel. Popular/Trending = 1.0, New = 0.3. |

```python
# thumbs_scorer.py
def compute_thumb_score(row: dict) -> float:
    ccu_pct   = row['ccu_percentile_within_tag']     # 0.0 - 1.0
    stint_n   = row['avg_stint_minutes_normalized']  # 0.0 - 1.0
    ab_winner = row['ab_winner_bonus']               # 0.0, 0.5 ou 1.0
    panel_t   = row['panel_tier_score']              # 0.0 - 1.0

    score = (ccu_pct   * 0.40
           + stint_n   * 0.30
           + ab_winner * 0.20
           + panel_t   * 0.10)
    return round(score, 4)

# Threshold para entrar no dataset de treino
SCORE_THRESHOLD = 0.45  # top ~30% de cada categoria
```

### 4.2 Filtros obrigatórios antes do scoring

- `image_url IS NOT NULL` — descarta ilhas sem thumbnail registrada
- `link_state = 'ACTIVE'` — descarta ilhas desativadas ou em moderação
- Min 1 registro em `discovery_exposure_presence_segments` — ilha nunca vista no Discovery é excluída
- `image_url` não duplicada (deduplicação por URL exata) — evita treinar na mesma imagem múltiplas vezes
- Resolução mínima: 800x450 verificada no download — thumbs corrompidas são descartadas

### 4.3 Volume esperado após curadoria

| Etapa | Volume estimado |
|---|---|
| Total no Supabase | ~90.000 |
| Após filtros obrigatórios | ~72.000 |
| Após score >= 0.45 | ~21.000 |
| Após deduplicação | ~18.000 |
| Distribuído em 8-12 clusters | ~1.500–2.500 por cluster |

---

## 5. Sistema de Clustering Visual

O Discovery da Epic tem 20-30 painéis com tags distintas, mas muitas dessas tags têm estilo visual sobreposto. Treinar um LoRA por tag individual seria ineficiente (20-30 modelos para gerenciar) e alguns clusters teriam volume insuficiente. A solução é agrupar tags com estilo visual similar em clusters antes do treino.

### 5.1 Por que CLIP embeddings e não agrupamento manual

O agrupamento manual seria subjetivo e trabalhoso. O CLIP (Contrastive Language-Image Pre-training da OpenAI) projeta imagens no mesmo espaço vetorial onde thumbnails visualmente similares ficam próximas. K-Means nesse espaço revela os clusters reais que existem nos dados — não os que imaginamos existir.

### 5.2 Script de clustering — thumb_clusterer.py

```python
# thumb_clusterer.py
# pip install open-clip-torch scikit-learn pillow

import open_clip
import torch
import numpy as np
from sklearn.cluster import KMeans
from sklearn.preprocessing import normalize
from PIL import Image

MODEL_NAME = 'ViT-B-32'
PRETRAINED = 'openai'
N_CLUSTERS = 10  # ajustar após análise do silhouette score
BATCH_SIZE = 64

model, _, preprocess = open_clip.create_model_and_transforms(
    MODEL_NAME, pretrained=PRETRAINED
)
model.eval()

def embed_images(image_paths: list[str]) -> np.ndarray:
    all_embeds = []
    for i in range(0, len(image_paths), BATCH_SIZE):
        batch = image_paths[i:i+BATCH_SIZE]
        imgs = torch.stack([preprocess(Image.open(p)) for p in batch])
        with torch.no_grad():
            feats = model.encode_image(imgs)
        all_embeds.append(feats.cpu().numpy())
    return normalize(np.vstack(all_embeds))

def cluster_thumbs(image_paths: list[str], metadata: list[dict]):
    embeds = embed_images(image_paths)
    km = KMeans(n_clusters=N_CLUSTERS, random_state=42, n_init=10)
    labels = km.fit_predict(embeds)

    result = []
    for i, (path, meta) in enumerate(zip(image_paths, metadata)):
        result.append({
            'link_code': meta['link_code'],
            'cluster_id': int(labels[i]),
            'feature_tags': meta['feature_tags'],
            'score': meta['score'],
            'image_path': path
        })
    return result, km
```

Após o clustering, fazer validação manual: visualizar 20-30 thumbs aleatórias de cada cluster e confirmar que fazem sentido visualmente. Clusters com menos de 500 imagens após curadoria são mesclados ao cluster mais próximo.

### 5.3 Estrutura do cluster_manifest.json

```json
{
  "version": "2026-Q1",
  "generated_at": "2026-02-27T00:00:00Z",
  "n_clusters": 10,
  "clusters": [
    {
      "cluster_id": 0,
      "display_name": "Tycoon & Economy",
      "tags_included": ["Tycoon", "Economy", "Farm", "Shop"],
      "trigger_word": "fnc_tycoon_thumb",
      "image_count": 2341,
      "lora_fal_path": "https://fal.ai/.../cluster_0_tycoon_v1.safetensors",
      "lora_version": "1.0",
      "trained_at": "2026-02-28",
      "status": "active"
    }
  ]
}
```

---

## 6. Pipeline de Download Organizado

O AI Toolkit requer imagens locais no disco — não aceita URLs. O pipeline de download é executado uma vez antes do treino (e novamente a cada retreino trimestral).

### 6.1 Estrutura de pastas de saída

```
/opt/tgis/
├── dataset/
│   ├── cluster_0_tycoon/
│   │   ├── 4826-5238-3419.png
│   │   ├── 4826-5238-3419.txt   ← caption gerado pelo GPT-4o Vision
│   │   ├── 7123-4521-8832.png
│   │   └── 7123-4521-8832.txt
│   ├── cluster_1_battle/
│   ├── cluster_2_horror/
│   └── ... (N clusters)
├── loras/
│   ├── cluster_0_tycoon_v1.safetensors
│   └── cluster_1_battle_v1.safetensors
├── cluster_manifest.json
├── scoring_results.parquet
└── logs/
    ├── download_run_2026-02-27.log
    └── training_run_2026-02-28.log
```

### 6.2 Script completo — thumb_pipeline.py

```python
# thumb_pipeline.py — Extração, scoring e download organizado
# pip install supabase requests Pillow tqdm pandas pyarrow

import os
import json
import requests
import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image
import pandas as pd
from supabase import create_client
from tqdm import tqdm

# ── Config ──────────────────────────────────────────────────────
SUPABASE_URL    = os.environ['SUPABASE_URL']
SUPABASE_KEY    = os.environ['SUPABASE_SERVICE_ROLE_KEY']
OUTPUT_DIR      = Path('/opt/tgis/dataset')
SCORE_THRESHOLD = 0.45
MIN_WIDTH       = 800
MIN_HEIGHT      = 450
MAX_WORKERS     = 8
TIMEOUT         = 15

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('thumb_pipeline')

# ── Etapa 1: Extração do Supabase ────────────────────────────────
def fetch_candidates() -> pd.DataFrame:
    log.info('Buscando candidatos no Supabase...')
    rows = []
    page_size = 1000
    offset = 0
    while True:
        res = (supabase.table('discover_link_metadata')
               .select('link_code, image_url, feature_tags, link_state')
               .eq('link_code_type', 'island')
               .eq('link_state', 'ACTIVE')
               .not_.is_('image_url', 'null')
               .range(offset, offset + page_size - 1)
               .execute())
        if not res.data:
            break
        rows.extend(res.data)
        offset += page_size
        if len(res.data) < page_size:
            break
    log.info(f'  {len(rows)} candidatos encontrados')
    return pd.DataFrame(rows)

# ── Etapa 2: Scoring via RPC ─────────────────────────────────────
def compute_scores(df: pd.DataFrame) -> pd.DataFrame:
    log.info('Calculando scores de qualidade...')
    # Chama a função RPC get_thumb_scoring_data (ver Seção 16)
    ccu_res = supabase.rpc('get_thumb_scoring_data', {}).execute()
    ccu_df  = pd.DataFrame(ccu_res.data)
    df = df.merge(ccu_df, on='link_code', how='left')
    df['score'] = (
        df['ccu_percentile_within_tag'].fillna(0) * 0.40 +
        df['avg_stint_minutes_normalized'].fillna(0) * 0.30 +
        df['ab_winner_bonus'].fillna(0) * 0.20 +
        df['panel_tier_score'].fillna(0) * 0.10
    ).round(4)
    qualified = df[df['score'] >= SCORE_THRESHOLD].copy()
    log.info(f'  {len(qualified)}/{len(df)} thumbs qualificadas (score >= {SCORE_THRESHOLD})')
    qualified.to_parquet('/opt/tgis/scoring_results.parquet')
    return qualified

# ── Etapa 3: Download paralelo com validação ─────────────────────
def download_thumb(row: dict, cluster_dir: Path) -> bool:
    url   = row['image_url']
    fname = row['link_code'] + '.png'
    dest  = cluster_dir / fname
    if dest.exists():
        return True  # idempotente
    try:
        r = requests.get(url, timeout=TIMEOUT, stream=True)
        r.raise_for_status()
        tmp = dest.with_suffix('.tmp')
        tmp.write_bytes(r.content)
        with Image.open(tmp) as img:
            if img.width < MIN_WIDTH or img.height < MIN_HEIGHT:
                tmp.unlink()
                return False
            img.save(dest, 'PNG')
        tmp.unlink(missing_ok=True)
        return True
    except Exception as e:
        log.warning(f'  Falha ao baixar {url}: {e}')
        return False

def download_all(df: pd.DataFrame, cluster_map: dict):
    log.info('Iniciando downloads...')
    futures = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for _, row in df.iterrows():
            cluster_id  = cluster_map.get(row['link_code'], 'unclustered')
            cluster_dir = OUTPUT_DIR / f'cluster_{cluster_id}'
            cluster_dir.mkdir(parents=True, exist_ok=True)
            fut = pool.submit(download_thumb, row.to_dict(), cluster_dir)
            futures[fut] = row['link_code']
    ok = sum(1 for f in tqdm(as_completed(futures)) if f.result())
    log.info(f'  {ok}/{len(futures)} downloads concluídos com sucesso')

# ── Entry point ──────────────────────────────────────────────────
if __name__ == '__main__':
    df        = fetch_candidates()
    qualified = compute_scores(df)
    # cluster_map vem do thumb_clusterer.py (link_code -> cluster_id)
    cluster_map = json.load(open('/opt/tgis/cluster_map.json'))
    download_all(qualified, cluster_map)
```

---

## 7. Sistema de Caption Automático

Cada imagem no dataset de treino precisa de um arquivo `.txt` com a mesma base de nome (ex: `4826-5238-3419.txt` para `4826-5238-3419.png`) contendo a descrição da imagem. Esse caption é o que ensina o LoRA a associar conceitos linguísticos ao estilo visual.

### 7.1 Prompt estruturado para o GPT-4o Vision

```python
CAPTION_SYSTEM_PROMPT = """
Você é um especialista em thumbnails de jogos. Analise a imagem e descreva-a
em inglês, de forma concisa (máximo 120 palavras), focando em:
1. Estilo visual geral (cartoon, 3D realista, colorido vibrante, sombrio, etc.)
2. Personagens ou elementos principais presentes
3. Paleta de cores dominante (2-3 cores principais)
4. Composição e layout (personagem em destaque, paisagem, texto em cima, etc.)
5. Elementos de game UI presentes (moedas, contadores, badges, etc.)
6. Mood e atmosfera (action, fun, scary, competitive, relaxed, etc.)
Não mencione o nome da ilha. Não invente elementos que não estão visíveis.
Comece diretamente com a descrição, sem preamble.
"""

# Exemplo de caption gerado:
# "Vibrant 3D cartoon thumbnail featuring a smiling golden character
# holding oversized coins against a bright blue sky background.
# Dominant colors: yellow, gold, sky blue. Large white text overlay
# at top. Fun and energetic atmosphere typical of tycoon game art.
# Currency icons and shop UI elements in lower corners."
```

### 7.2 Script de geração de captions — thumb_captioner.py

```python
# thumb_captioner.py
# pip install openai pillow tqdm

import os
import base64
from pathlib import Path
from openai import OpenAI
from tqdm import tqdm

client      = OpenAI(api_key=os.environ['OPENAI_API_KEY'])
DATASET_DIR = Path('/opt/tgis/dataset')
COST_PER_IMAGE = 0.0015  # estimativa gpt-4o vision

def encode_image(path: Path) -> str:
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')

def generate_caption(image_path: Path) -> str:
    txt_path = image_path.with_suffix('.txt')
    if txt_path.exists():
        return txt_path.read_text()  # idempotente
    b64 = encode_image(image_path)
    response = client.chat.completions.create(
        model='gpt-4o',
        messages=[
            {'role': 'system', 'content': CAPTION_SYSTEM_PROMPT},
            {'role': 'user', 'content': [
                {'type': 'image_url',
                 'image_url': {'url': f'data:image/png;base64,{b64}', 'detail': 'low'}}
            ]}
        ],
        max_tokens=200
    )
    caption = response.choices[0].message.content.strip()
    txt_path.write_text(caption)
    return caption

def caption_all_clusters():
    images     = list(DATASET_DIR.rglob('*.png'))
    uncaptioned = [p for p in images if not p.with_suffix('.txt').exists()]
    print(f'Gerando captions para {len(uncaptioned)} imagens...')
    print(f'Custo estimado: ${len(uncaptioned) * COST_PER_IMAGE:.2f}')
    for img_path in tqdm(uncaptioned):
        generate_caption(img_path)

if __name__ == '__main__':
    caption_all_clusters()
```

> **Custo estimado:** ~$0.0015 por imagem. Para 18.000 imagens = ~$27. Esse custo ocorre apenas uma vez por ciclo de retreino.

---

## 8. Treino dos LoRAs por Cluster

### 8.1 Configuração do AI Toolkit

```yaml
# config/cluster_0_tycoon.yaml
job: extension
config:
  name: 'tgis_cluster_0_tycoon_v1'
  process:
    - type: 'sd_trainer'
      training_folder: '/opt/tgis/dataset/cluster_0_tycoon'
      device: cuda:0
      trigger_word: 'fnc_tycoon_thumb'
      network:
        type: lora
        linear: 16
        linear_alpha: 16
      save:
        dtype: float16
        save_every: 250
        max_step_saves_to_keep: 4
      datasets:
        - folder_path: '/opt/tgis/dataset/cluster_0_tycoon'
          caption_ext: txt
          resolution: [1024, 576]   # 16:9 — inferência upscale para 1920x1080
          shuffle_tokens: false
          cache_latents_to_disk: true
          batch_size: 1
      train:
        batch_size: 1
        steps: 2000
        gradient_accumulation_steps: 4
        train_unet: true
        train_text_encoder: false
        learning_rate: 1e-4
        optimizer: adamw8bit
        lr_scheduler: cosine
        lr_warmup_steps: 100
        max_grad_norm: 1.0
        noise_scheduler: flowmatch
      model:
        name_or_path: 'Tongyi-MAI/Z-Image-Turbo'
        assistant_lora_path: 'ostris/zimage_turbo_training_adapter'
        is_flux: false
        quantize: true
```

### 8.2 Parâmetros críticos explicados

| Parâmetro | Valor | Por quê |
|---|---|---|
| `steps` | 2000 | Treinos curtos preservam a destilação do Turbo. Acima de 3000 começa a degradar. |
| `rank (linear)` | 16 | Suficiente para aprender estilo visual. Rank maior = mais risco de overfitting. |
| `trigger_word` | `fnc_tycoon_thumb` | Token único que ativa o LoRA específico. Prefixo `fnc_` evita conflito com tokens genéricos. |
| `resolution` | 1024x576 | 16:9 em resolução de treino. A inferência final é 1920x1080. |
| `batch_size` | 1 + accum 4 | Efetivo batch de 4 sem estourar VRAM de 16GB. |
| `assistant_lora` | ostris adapter | Crítico — sem isso a destilação quebra durante o treino. |
| `train_text_encoder` | false | Não treinar text encoder preserva a semântica do modelo base. |

### 8.3 Custo e tempo de treino por cluster

| GPU | VRAM | Custo/hr | Tempo por cluster | Custo por cluster | Total (12 clusters) |
|---|---|---|---|---|---|
| RTX 4090 | 24GB | $0.45 | 2-3h | ~$1.10 | ~$13 |
| A100 40GB | 40GB | $1.30 | 1-1.5h | ~$1.60 | ~$19 |
| H100 SXM | 80GB | $2.50 | <1h | ~$2.00 | ~$24 |

> **Recomendação:** RTX 4090 no RunPod ou Vast.ai. Custo total para treinar todos os clusters pela primeira vez: ~$15-20. Com margem de erro e re-treinos de ajuste: orçar $50.

### 8.4 Validação antes de promover para produção

- Gerar 20 imagens de teste com prompts representativos do cluster
- Avaliação visual: o estilo se alinha com as top thumbs do cluster?
- Teste de prompt adherence: o trigger word ativa o estilo correto?
- Teste de diversidade: as 20 imagens são variadas ou todas iguais? (overfitting)
- Gate de promoção: aprovação manual antes de atualizar `cluster_manifest.json`

---

## 9. Pipeline de Geração — Runtime

### 9.1 Fluxo completo

```
Usuário digita prompt + seleciona categoria
          ↓
Edge Function: tgis-generate (Supabase)
          ↓
  [1] Carrega cluster_manifest.json do Storage
  [2] Identifica cluster_id pela categoria selecionada
  [3] Carrega lora_fal_path do cluster ativo
          ↓
  [4] GPT-4o-mini: reescrita inteligente do prompt
      Input:  prompt do usuário + categoria + trigger_word do cluster
      Output: prompt otimizado para o Z-Image-Turbo
          ↓
  [5] fal.ai API: geração com Z-Image-Turbo + LoRA
      - 4 variações em paralelo (4 seeds distintos)
      - Resolução: 1920x1080
      - Steps: 8 (Turbo distilado)
          ↓
  [6] Retorna 4 URLs de imagem para o frontend
          ↓
Frontend exibe as 4 variações para o usuário escolher
```

### 9.2 Prompt rewrite — GPT-4o-mini

```python
REWRITE_SYSTEM_PROMPT = """
Você é um especialista em prompts para geração de imagens de thumbnails de jogos.
Receberá uma descrição simples de um usuário e deve reescrevê-la como um prompt
detalhado para o modelo Z-Image-Turbo, que irá gerar uma thumbnail de Fortnite Creative.

Regras:
- Comece SEMPRE com o trigger word fornecido
- Descreva elementos visuais concretos, não conceitos abstratos
- Inclua: estilo visual, personagens, cores, composição, energia/mood
- Mantenha entre 40-80 palavras
- Não use negativos no prompt positivo
- Fortnite Creative thumbnails são vibrantes, coloridas, com personagens em destaque
"""

# Exemplo:
# Input do usuário: "uma ilha de tycoon com muito dinheiro"
# Trigger word: "fnc_tycoon_thumb"
# Output: "fnc_tycoon_thumb, vibrant 3D cartoon tycoon island thumbnail,
#   smiling character surrounded by giant golden coins and cash bills,
#   bright yellow and gold color palette, blue sky background, dynamic
#   upward composition, energetic fun atmosphere, money counters and
#   shop icons, Fortnite Creative art style"
```

### 9.3 Edge Function: tgis-generate

```typescript
// supabase/functions/tgis-generate/index.ts
import { serve } from 'https://deno.land/std/http/server.ts'

const FAL_API_KEY  = Deno.env.get('FAL_API_KEY')!
const OPENAI_KEY   = Deno.env.get('OPENAI_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  const { user_prompt, category } = await req.json()

  // 1. Carregar manifest e identificar LoRA
  const manifest = await loadManifest()
  const cluster = manifest.clusters.find(
    (c: any) => c.tags_included.includes(category)
  )
  if (!cluster) return new Response('Categoria não suportada', { status: 400 })

  // 2. Reescrita do prompt
  const rewritten = await rewritePrompt(user_prompt, category, cluster.trigger_word)

  // 3. Geração: 4 variações em paralelo
  const seeds = [42, 137, 2048, 99999]
  const generations = await Promise.all(
    seeds.map(seed => generateImage(rewritten, cluster.lora_fal_path, seed))
  )

  // 4. Log de geração (auditoria)
  await logGeneration({ user_prompt, rewritten, cluster_id: cluster.cluster_id, category })

  return Response.json({ images: generations, rewritten_prompt: rewritten })
})

async function generateImage(prompt: string, loraPath: string, seed: number) {
  const response = await fetch('https://fal.run/fal-ai/z-image-turbo', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt,
      image_size: { width: 1920, height: 1080 },
      num_inference_steps: 8,
      seed,
      loras: [{ path: loraPath, scale: 0.9 }],
      enable_safety_checker: true
    })
  })
  const data = await response.json()
  return data.images[0].url
}

async function rewritePrompt(userPrompt: string, category: string, triggerWord: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: REWRITE_SYSTEM_PROMPT },
        { role: 'user', content: `Prompt: ${userPrompt}\nCategoria: ${category}\nTrigger word: ${triggerWord}` }
      ],
      max_tokens: 150
    })
  })
  const data = await response.json()
  return data.choices[0].message.content.trim()
}

async function loadManifest() {
  // Busca cluster_manifest.json do Supabase Storage
  const { data } = await fetch(
    `${SUPABASE_URL}/storage/v1/object/public/tgis/cluster_manifest.json`
  ).then(r => r.json())
  return data
}

async function logGeneration(params: any) {
  await fetch(`${SUPABASE_URL}/rest/v1/tgis_generation_log`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  })
}
```

> **IMPORTANTE:** A API key do fal.ai fica armazenada como secret na Edge Function do Supabase. O usuário nunca vê, nunca configura, nunca precisa ter conta no fal.ai. Para ele, é apenas um botão que gera thumbnails.

---

## 10. UX e Integração no Surprise Radar

### 10.1 Posicionamento no produto

Terceira ferramenta da área logada, ao lado do Workspace e do Island Lookup. Rota: `/app/thumb-generator`. Nome no menu: **Thumb Generator**.

### 10.2 Atualização do AppSidebar.tsx

```typescript
// src/components/AppSidebar.tsx — adicionar nova ferramenta
import { Image } from 'lucide-react'

const tools = [
  { title: 'Workspace',       url: '/app',                 icon: FolderOpen, end: true },
  { title: 'Island Lookup',   url: '/app/island-lookup',   icon: Search },
  { title: 'Thumb Generator', url: '/app/thumb-generator', icon: Image },  // NOVO
]
```

### 10.3 Fluxo UX da tela de geração

Tela única sem abas:

- **Header:** "Thumb Generator" com subtítulo "Gere thumbnails baseadas nos padrões que performam no Discovery"
- **Campo de prompt:** textarea com placeholder "Descreva sua thumbnail...", limite 200 chars
- **Seletor de categoria:** chips visuais com as tags disponíveis (não dropdown)
- **Botão "Gerar Thumbnails":** CTA primário, desabilitado até ter prompt + categoria selecionada
- **Grid de resultado:** 2x2 com as 4 variações geradas
- **Cada card:** hover revela botão download (PNG 1920x1080) e botão "Regenerar essa"
- **Collapsible:** "Ver como o sistema interpretou seu prompt" mostra o prompt reescrito
- **Disclaimer obrigatório:** "Baseado em padrões visuais de ilhas que performaram bem no Discovery. Não garante entrada em painéis."

### 10.4 ThumbGenerator.tsx — estrutura

```typescript
// src/pages/ThumbGenerator.tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/integrations/supabase/client'

// Categorias — expandir com clusters reais após clustering
const CATEGORIES = [
  'Tycoon', 'Battle Royale', 'Horror', 'Deathrun', 'Roleplay',
  'Adventure', 'Prop Hunt', 'Parkour', 'Survival', 'Party'
]

export function ThumbGenerator() {
  const [prompt,    setPrompt]    = useState('')
  const [category,  setCategory]  = useState<string | null>(null)
  const [images,    setImages]    = useState<string[]>([])
  const [loading,   setLoading]   = useState(false)
  const [rewritten, setRewritten] = useState<string | null>(null)

  async function handleGenerate() {
    if (!prompt || !category) return
    setLoading(true)
    const { data, error } = await supabase.functions.invoke('tgis-generate', {
      body: { user_prompt: prompt, category }
    })
    if (data) {
      setImages(data.images)
      setRewritten(data.rewritten_prompt)
    }
    setLoading(false)
  }

  // JSX: prompt input + category chips + generate button + 2x2 grid
}
```

---

## 11. Infraestrutura e Deploy

### 11.1 Diagrama de componentes

```
┌─────────────────────────────────────────────────────────────┐
│                   TGIS — Runtime                            │
│                                                              │
│  Frontend (React/Vite — Vercel/Netlify)                     │
│    /app/thumb-generator → ThumbGenerator.tsx                │
│              ↓ supabase.functions.invoke                    │
│  Supabase Edge Functions (Deno)                             │
│    tgis-generate                                             │
│      → OpenAI (GPT-4o-mini) — prompt rewrite               │
│      → fal.ai (Z-Image-Turbo + LoRA) — geração             │
│      → Supabase Storage — cluster_manifest.json             │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                   TGIS — Treino (Hetzner CX22)              │
│                                                              │
│  thumb_pipeline.py    → Extração + Scoring (Supabase)       │
│  thumb_clusterer.py   → CLIP embeddings + K-Means           │
│  thumb_captioner.py   → GPT-4o Vision captions              │
│  AI Toolkit trainer   → LoRA por cluster (RunPod GPU)       │
│  lora_uploader.py     → Upload LoRAs para fal.ai            │
│  cluster_manifest.py  → Atualiza manifest no Storage        │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 Variáveis de ambiente necessárias

| Variável | Onde usar | Origem |
|---|---|---|
| `FAL_API_KEY` | Edge Function tgis-generate | fal.ai dashboard |
| `OPENAI_API_KEY` | Edge Function + thumb_captioner.py | OpenAI platform |
| `SUPABASE_URL` | thumb_pipeline.py + Edge Functions | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | thumb_pipeline.py (leitura batch) | Supabase project settings |

### 11.3 Onde ficam os LoRAs em produção

Os arquivos `.safetensors` dos LoRAs são hospedados no fal.ai Model Registry. Após o treino no RunPod/Vast.ai, o arquivo é subido via fal.ai CLI ou API. O `cluster_manifest.json` armazena o path de cada LoRA no fal.ai e é servido pelo Supabase Storage.

```python
# lora_uploader.py — Sobe LoRA para fal.ai após treino
import fal_client
import os

def upload_lora(local_path: str, cluster_name: str) -> str:
    result = fal_client.upload_file(local_path)
    url = result['url']
    print(f'LoRA {cluster_name} disponível em: {url}')
    return url
```

---

## 12. Estratégia de Retreino

### 12.1 Calendário fixo — trimestral

| Ciclo | Período | Ação |
|---|---|---|
| Q1 2026 | Março 2026 | Primeiro treino completo — todos os clusters |
| Q2 2026 | Junho 2026 | Retreino com dados dos últimos 90 dias |
| Q3 2026 | Setembro 2026 | Retreino + reavaliação dos clusters |
| Q4 2026 | Dezembro 2026 | Retreino + expansão se volume permitir |

### 12.2 Retreino pontual — integração com DPPI

Quando o DPPI detectar PSI > 0.25 em features de CCU e stint para uma tag específica por 3 treinos consecutivos:

- Trigger: alerta `model_drift_severe` do DPPI para a categoria
- Ação: retreino do cluster mapeado para essa tag
- Custo: ~$3-5 por retreino pontual de um cluster
- Prazo: executar em até 7 dias após o alerta

### 12.3 O que muda entre ciclos

- **Dataset:** novas thumbs das ilhas que entraram em painéis nos últimos 90 dias com score alto são adicionadas
- **Clusters:** se surgiu nova categoria com volume > 500 thumbs curadas, novo cluster é criado
- **Hiperparâmetros:** ajuste de steps e learning rate baseado na avaliação visual do ciclo anterior
- **cluster_manifest.json:** atualizado com novos `lora_fal_path` e version incrementada

---

## 13. Custos e Modelo de Negócio

### 13.1 Investimento inicial (única vez)

| Item | Custo estimado |
|---|---|
| Treino todos os clusters (12x) | $15–20 |
| Iterações e re-treinos de ajuste | $20 |
| Captioning GPT-4o Vision (18k imgs) | $27 |
| Testes de geração e validação | $5 |
| **Total MVP** | **~$70–75** |

### 13.2 Custo variável por geração

| Componente | Custo por request |
|---|---|
| GPT-4o-mini (prompt rewrite) | $0.0003 |
| Z-Image-Turbo via fal.ai (4 variações) | $0.006 |
| Supabase Edge Function | < $0.0001 |
| **Total por set de 4 thumbnails** | **~$0.007** |

### 13.3 Simulação de escala

| Usuários | Receita/mês | Custo variável | Custo fixo | Lucro/mês | Margem |
|---|---|---|---|---|---|
| 50 | $995 | $17.50 | $15 | ~$962 | ~97% |
| 200 | $3.980 | $70 | $20 | ~$3.890 | ~98% |
| 500 | $9.950 | $175 | $30 | ~$9.745 | ~98% |
| 1.000 | $19.900 | $350 | $50 | ~$19.500 | ~98% |

---

## 14. Estrutura de Arquivos do Projeto

### Worker Python — Hetzner CX22

```
/opt/tgis/
├── .env
├── requirements.txt
├── cluster_manifest.json
├── tgis/
│   ├── config.py                    ← Constantes, env vars, thresholds
│   ├── db.py                        ← Conexão Supabase, helpers de query
│   ├── pipeline/
│   │   ├── extractor.py             ← Extração de candidatos do Supabase
│   │   ├── scorer.py                ← Cálculo de score de qualidade
│   │   ├── downloader.py            ← Download paralelo com validação
│   │   └── deduplicator.py          ← Remoção de duplicatas por hash
│   ├── clustering/
│   │   ├── embedder.py              ← CLIP embeddings das thumbs
│   │   ├── clusterer.py             ← K-Means + análise de silhouette
│   │   └── manifest_writer.py       ← Gera cluster_manifest.json
│   ├── captioning/
│   │   └── captioner.py             ← GPT-4o Vision captions estruturados
│   ├── training/
│   │   ├── config_generator.py      ← Gera YAML do AI Toolkit por cluster
│   │   └── lora_uploader.py         ← Upload de LoRAs para fal.ai
│   └── orchestrator.py              ← Entry point — orquestra todas as etapas
├── dataset/                         ← Thumbs organizadas por cluster
├── loras/                           ← LoRAs treinados localmente
├── config/                          ← YAMLs do AI Toolkit por cluster
└── logs/
```

### Epic Insight Engine — Repositório principal

```
epic-insight-engine/
├── src/
│   ├── pages/
│   │   └── ThumbGenerator.tsx           ← NOVO
│   ├── components/
│   │   ├── AppSidebar.tsx               ← MODIFICAR — adicionar item de menu
│   │   └── thumb/
│   │       ├── ThumbPromptInput.tsx      ← NOVO
│   │       ├── CategoryChips.tsx         ← NOVO
│   │       ├── ThumbResultGrid.tsx       ← NOVO
│   │       └── ThumbCard.tsx             ← NOVO
├── supabase/
│   ├── functions/
│   │   └── tgis-generate/               ← NOVO
│   │       └── index.ts
│   └── migrations/
│       ├── tgis_generation_log.sql       ← NOVO
│       └── tgis_cluster_registry.sql     ← NOVO
```

---

## 15. Migrations Supabase

### 15.1 tgis_generation_log

```sql
CREATE TABLE IF NOT EXISTS public.tgis_generation_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id          UUID REFERENCES auth.users(id),
  user_prompt      TEXT NOT NULL,
  rewritten_prompt TEXT,
  category         TEXT NOT NULL,
  cluster_id       INT NOT NULL,
  lora_version     TEXT NOT NULL,
  image_urls       JSONB NOT NULL,       -- array de 4 URLs
  generation_ms    INT,
  fal_request_id   TEXT
);

CREATE INDEX idx_tgis_log_user    ON tgis_generation_log(user_id, created_at DESC);
CREATE INDEX idx_tgis_log_cluster ON tgis_generation_log(cluster_id, created_at DESC);

ALTER TABLE public.tgis_generation_log ENABLE ROW LEVEL SECURITY;

-- Usuário vê apenas suas próprias gerações
CREATE POLICY tgis_log_select ON public.tgis_generation_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Escritas apenas via service_role (Edge Function)
CREATE POLICY tgis_log_insert ON public.tgis_generation_log
  FOR INSERT TO public
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
```

### 15.2 tgis_cluster_registry

```sql
CREATE TABLE IF NOT EXISTS public.tgis_cluster_registry (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id     INT NOT NULL,
  cluster_name   TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  tags_included  TEXT[] NOT NULL,
  trigger_word   TEXT NOT NULL,
  lora_fal_path  TEXT NOT NULL,
  version        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'candidate', -- candidate | active | retired
  trained_at     TIMESTAMPTZ NOT NULL,
  dataset_size   INT NOT NULL,
  training_steps INT NOT NULL,
  promoted_at    TIMESTAMPTZ,
  retired_at     TIMESTAMPTZ,
  notes          TEXT
);

-- Garante apenas um LoRA ativo por cluster
CREATE UNIQUE INDEX idx_tgis_registry_active
  ON tgis_cluster_registry(cluster_id)
  WHERE status = 'active';
```

---

## 16. Função RPC Supabase para Scoring

```sql
-- Migration: get_thumb_scoring_data
CREATE OR REPLACE FUNCTION public.get_thumb_scoring_data()
RETURNS TABLE (
  link_code                    TEXT,
  avg_ccu                      FLOAT,
  ccu_percentile_within_tag    FLOAT,
  avg_stint_minutes            FLOAT,
  avg_stint_minutes_normalized FLOAT,
  ab_winner_bonus              FLOAT,
  panel_tier_score             FLOAT,
  primary_tag                  TEXT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH
  -- CCU médio por ilha (últimos 90 dias)
  ccu_base AS (
    SELECT link_code,
           AVG(NULLIF(ccu_max, 0)) AS avg_ccu,
           MAX(feature_tags->>0)   AS primary_tag
    FROM discovery_exposure_rollup_daily
    WHERE date >= now() - INTERVAL '90 days'
    GROUP BY link_code
  ),
  -- Percentil de CCU dentro da mesma tag
  ccu_pct AS (
    SELECT link_code, primary_tag,
           PERCENT_RANK() OVER (
             PARTITION BY primary_tag ORDER BY avg_ccu
           ) AS ccu_percentile_within_tag
    FROM ccu_base
  ),
  -- Stint médio por ilha
  stints AS (
    SELECT link_code,
           AVG(EXTRACT(EPOCH FROM (end_ts - start_ts))/60) AS avg_stint_minutes
    FROM discovery_exposure_presence_segments
    WHERE start_ts >= now() - INTERVAL '90 days'
      AND closed_reason IS NOT NULL
    GROUP BY link_code
  ),
  -- P90 de stint para normalização
  stint_p90 AS (
    SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY avg_stint_minutes) AS p90
    FROM stints
  ),
  -- A/B winner bonus
  ab_test AS (
    SELECT e.link_code,
           CASE
             WHEN after_ccu > before_ccu * 1.1 THEN 1.0
             WHEN after_ccu >= before_ccu * 0.9 THEN 0.5
             ELSE 0.0
           END AS ab_winner_bonus
    FROM discover_link_metadata_events e
    JOIN LATERAL (
      SELECT
        AVG(CASE WHEN date < e.ts::date THEN ccu_max END) AS before_ccu,
        AVG(CASE WHEN date >= e.ts::date THEN ccu_max END) AS after_ccu
      FROM discovery_exposure_rollup_daily r
      WHERE r.link_code = e.link_code
        AND r.date BETWEEN e.ts::date - 14 AND e.ts::date + 14
    ) ab_calc ON true
    WHERE e.event_type = 'thumb_changed'
  ),
  -- Tier score do melhor painel da ilha
  panel_score AS (
    SELECT link_code,
           MAX(CASE panel_name
             WHEN 'Nested_Popular'    THEN 1.0
             WHEN 'Trending_Variety'  THEN 0.9
             WHEN 'Epics_Picks'       THEN 0.85
             ELSE 0.3
           END) AS panel_tier_score
    FROM discovery_exposure_presence_segments
    WHERE start_ts >= now() - INTERVAL '90 days'
    GROUP BY link_code
  )
  SELECT
    c.link_code,
    c.avg_ccu,
    COALESCE(p.ccu_percentile_within_tag, 0)                         AS ccu_percentile_within_tag,
    COALESCE(s.avg_stint_minutes, 0)                                  AS avg_stint_minutes,
    COALESCE(s.avg_stint_minutes / NULLIF(sp.p90, 0), 0)             AS avg_stint_minutes_normalized,
    COALESCE(ab.ab_winner_bonus, 0)                                   AS ab_winner_bonus,
    COALESCE(ps.panel_tier_score, 0.3)                                AS panel_tier_score,
    c.primary_tag
  FROM ccu_base c
  CROSS JOIN stint_p90 sp
  LEFT JOIN ccu_pct     p  USING (link_code)
  LEFT JOIN stints      s  USING (link_code)
  LEFT JOIN ab_test     ab USING (link_code)
  LEFT JOIN panel_score ps USING (link_code);
END $$;
```

---

## 17. Requirements e Setup

### 17.1 requirements.txt

```
supabase==2.4.6
requests==2.31.0
Pillow==10.3.0
tqdm==4.66.4
pandas==2.2.2
pyarrow==16.0.0
open-clip-torch==2.24.0
scikit-learn==1.4.2
numpy==1.26.4
openai==1.30.0
python-dotenv==1.0.1
fal-client==0.4.0
torch==2.3.0
torchvision==0.18.0
```

### 17.2 setup_tgis.sh

```bash
#!/bin/bash
# setup_tgis.sh — Rodar uma vez no Hetzner CX22

sudo apt update && sudo apt install -y python3.11 python3.11-venv python3-pip

mkdir -p /opt/tgis/dataset /opt/tgis/loras /opt/tgis/config /opt/tgis/logs

cd /opt/tgis
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cat > .env << 'EOF'
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
OPENAI_API_KEY=<openai-key>
FAL_API_KEY=<fal-key>
EOF

echo 'Setup TGIS concluído!'
```

### 17.3 Crontab para retreino trimestral

```bash
# crontab -e no Hetzner
# Retreino completo: primeiro dia de março, junho, setembro, dezembro às 02:00
0 2 1 3,6,9,12 * /opt/tgis/.venv/bin/python /opt/tgis/tgis/orchestrator.py >> /opt/tgis/logs/cron.log 2>&1

# Atualização mensal de dataset (sem retreino)
0 3 1 * * /opt/tgis/.venv/bin/python /opt/tgis/tgis/orchestrator.py --mode=dataset_only >> /opt/tgis/logs/cron.log 2>&1
```

---

## 18. Fases de Implementação

### Fase 0 — Infraestrutura e Pipeline de Dados (Semanas 1–2)

- [ ] Criar estrutura `/opt/tgis/` no Hetzner com venv e requirements
- [ ] Implementar `tgis/db.py` e `tgis/config.py`
- [ ] Criar função RPC `get_thumb_scoring_data` no Supabase
- [ ] Implementar `tgis/pipeline/extractor.py` e `scorer.py`
- [ ] Executar primeira extração e analisar distribuição de scores

**Critério de saída:** DataFrame de candidatos com scores calculados, ~18k thumbs qualificadas documentadas.

### Fase 1 — Download e Clustering (Semanas 2–3)

- [ ] Implementar `tgis/pipeline/downloader.py` com download paralelo
- [ ] Executar download completo do dataset qualificado
- [ ] Implementar `tgis/clustering/embedder.py` (CLIP embeddings)
- [ ] Executar clustering e análise do silhouette score para definir N de clusters
- [ ] Validação visual manual dos clusters
- [ ] Gerar `cluster_manifest.json` inicial

**Critério de saída:** Dataset organizado em pastas por cluster, manifest validado.

### Fase 2 — Captioning e Treino (Semanas 3–4)

- [ ] Implementar `tgis/captioning/captioner.py`
- [ ] Executar captioning de todas as imagens (~$27)
- [ ] Gerar YAMLs de configuração do AI Toolkit para cada cluster
- [ ] Treinar primeiro LoRA de validação (cluster Tycoon)
- [ ] Se aprovado: treinar todos os demais clusters (~$15-20 no RunPod)
- [ ] Upload dos LoRAs para fal.ai e atualização do `cluster_manifest.json`

**Critério de saída:** Todos os LoRAs no fal.ai, manifest atualizado com paths.

### Fase 3 — Edge Function e Frontend (Semanas 4–5)

- [ ] Criar migrations `tgis_generation_log` e `tgis_cluster_registry`
- [ ] Implementar `supabase/functions/tgis-generate/index.ts`
- [ ] Testar Edge Function com chamada manual
- [ ] Implementar `ThumbGenerator.tsx` e componentes filho
- [ ] Adicionar rota `/app/thumb-generator` no React Router
- [ ] Atualizar `AppSidebar.tsx` com nova entrada de menu

**Critério de saída:** Usuário logado consegue gerar 4 variações de thumbnail end-to-end.

### Fase 4 — Polimento e Automação (Semana 5+)

- [ ] Implementar `tgis/orchestrator.py` completo
- [ ] Configurar crontab no Hetzner para retreino trimestral
- [ ] Integrar alertas do DPPI como trigger de retreino pontual
- [ ] Adicionar histórico de gerações na área do usuário
- [ ] Release interno para teste com usuários reais

---

## 19. Garantias Operacionais

### 19.1 Fallback se LoRA indisponível

Se o fal.ai retornar erro para um LoRA específico, a Edge Function faz fallback para o Z-Image-Turbo sem LoRA, com o prompt reescrito e a categoria no prompt textual. O usuário recebe as imagens com nota: "Gerado com modelo padrão — o modelo especialista está temporariamente indisponível."

### 19.2 Rate limiting e proteção de custo

- Limite de 10 gerações por usuário por hora (validado via Supabase na Edge Function)
- Timeout de 30 segundos na Edge Function
- Alert se custo mensal estimado do fal.ai superar $50

### 19.3 Disclaimer obrigatório

Exibir sempre abaixo das imagens geradas:

> "Gerado com base em padrões visuais de ilhas que performaram bem no Discovery. Não garante entrada em painéis."

### 19.4 RLS

| Tabela | Leitura | Escrita |
|---|---|---|
| `tgis_generation_log` | Usuário autenticado (próprios registros) | Apenas service_role |
| `tgis_cluster_registry` | Apenas admin | Apenas service_role |
| `cluster_manifest.json` (Storage) | Pública (Edge Function lê) | Apenas service_role |

---

## 20. Glossário

| Termo | Definição |
|---|---|
| **LoRA** | Low-Rank Adaptation — fine-tuning que treina apenas uma fração dos parâmetros do modelo base, reduzindo custo dramaticamente. |
| **Z-Image-Turbo** | Modelo de geração de imagens de 6B parâmetros da Tongyi-MAI (Alibaba), com destilação que permite geração em 8 passos. |
| **Training Adapter** | LoRA do ostris que absorve a degradação da destilação durante o fine-tuning, preservando a velocidade do Turbo. |
| **CLIP Embeddings** | Representações vetoriais de imagens onde imagens visualmente similares ficam próximas no espaço vetorial. |
| **K-Means** | Algoritmo de clustering que agrupa pontos em K grupos baseado em proximidade vetorial. |
| **Silhouette Score** | Métrica de qualidade de clustering. Quanto mais próximo de 1, mais coesos e separados são os clusters. |
| **Trigger Word** | Token especial adicionado ao prompt que ativa o LoRA específico. Ex: `fnc_tycoon_thumb`. |
| **fal.ai** | Plataforma de inferência de modelos de IA com suporte nativo ao Z-Image-Turbo. Modelo pay-per-use. |
| **Prompt Rewrite** | Reescrita automática do prompt simples do usuário em descrição visual detalhada para o modelo. |
| **Caption** | Arquivo `.txt` com descrição textual de cada imagem de treino. Ensina o LoRA a associar conceitos visuais a palavras. |
| **cluster_manifest.json** | Arquivo que mapeia cada cluster ao seu LoRA ativo, versão, tags incluídas e trigger word. |
| **A/B Winner** | Thumbnail que foi trocada e resultou em aumento de CCU >= 10% nas 2 semanas seguintes. |
| **Panel Tier Score** | Score de 0-1 baseado no nível do painel. Popular/Trending = 1.0, New = 0.3. |
| **NFEs** | Number of Function Evaluations — número de passos de denoising. O Turbo usa apenas 8. |
| **PSI** | Population Stability Index — métrica de drift. Valores > 0.25 indicam mudança de regime. |

---

*Fim do documento. TGIS PRD Final v1.0 — 2026-02-27 — Surprise Radar — Confidencial*

---

## Addendum 2026-03-01 (Historical Note)

This addendum documents a temporary De-Turbo experiment executed during incident mitigation.
It is no longer the official production path.

Official path is defined in:
- `docs/TGIS_FAL_TRAINER_MIGRATION.md`
- `docs/TGIS_RUNBOOK.md`

Current production strategy:
1. Training: `fal-ai/z-image-turbo-trainer-v2`
2. Inference: `fal-ai/z-image/turbo/image-to-image/lora`
3. Base model policy: `Z-Image-Turbo` (De-Turbo path deprecated for V1 operations)
4. Output policy: final delivery target remains `1920x1080`

## Addendum 2026-03-02 (V1 Closure Status With Caveats)

V1 can be considered **functionally concluded** for platform scope, with two explicit caveats.

What is considered closed in V1 scope:
1. End-to-end training pipeline migrated to fal Trainer v2 (queue -> submit -> webhook -> candidate model).
2. Manual promotion/rollback flow active in admin.
3. Runtime generation active on i2i + LoRA with prompt rewrite and reference selection fallback.
4. Operational runbook and first-training guide documented for new pod/worker cycles.

Mandatory caveats before calling V1 quality fully complete:
1. **Remaining clusters training**: only part of the cluster set is trained/validated in production quality level; remaining clusters must be trained and QA-approved.
2. **Thumb separation quality**: current visual clustering/caption separation is still noisy ("poluida") in some groups and needs refinement before V2 quality targets.

Operational disclaimer to keep in all V1 planning and reviews:
> V1 platform is delivered, but model quality is still dependent on (a) full cluster training coverage and (b) improved thumbnail separation/curation quality.

Recommended gate to start V2 implementation:
1. Train and promote all remaining active clusters.
2. Run visual QA pass per cluster with acceptance checklist.
3. Execute one refinement cycle on dataset separation (cluster purity + caption specificity).
