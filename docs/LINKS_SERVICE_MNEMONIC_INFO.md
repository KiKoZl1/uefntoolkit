# Links Service (Mnemonic Info) - Card Metadata Canonico

Data: 2026-02-15

Objetivo: documentar o endpoint que resolve `link_code` (ilhas e collections) em metadata rica (title, thumbnails, textos, matchmaking, ratings etc.), que o Discovery V2 nao entrega.

---

## 1) Por que isso importa

A API de Discovery que usamos para exposure (`/api/v2/discovery/surface`, `/api/v2/discovery/surface/.../page`) retorna principalmente:

- `linkCode` (o identificador do tile)
- sinais de discovery: `globalCCU`, `lockStatus`, `lockStatusReason`, `isVisible`, etc.

Ela **nao retorna** a maior parte do "card metadata" que o usuario ve no Fortnite (thumbnail, title, tagline, screenshots, max players, etc).

O **Links Service / mnemonic info** vira entao a fonte canonica para:

- mostrar nome/thumb no admin/public
- enriquecer report e "intel" (mudancas, updates, qualidade, ratings)
- detectar mudancas de midia (thumb/title) ao longo do tempo

---

## 2) Endpoint principal (1 link_code)

### HTTP

GET:

`https://links-public-service-live.ol.epicgames.com/links/api/fn/mnemonic/{mnemonic}`

### Auth

Bearer token (EG1 ou bearer normal), com permissao de Links (`links:fn READ`).

- Sem token: `401`
- Sem permissao: `403 (missing_permission)`

### Entrada

`{mnemonic}` = o `link_code` que aparece no Discovery/Exposure:

- Ilha: `dddd-dddd-dddd` (ex: `4826-5238-3419`)
- Collections: `playlist_*`, `reference_*`, `ref_panel_*`, etc.

### Saida (campos relevantes)

Resposta e um JSON com informacoes no topo + um objeto `metadata`.

Campos top-level comuns:

- `namespace`
- `accountId` (dono)
- `creatorName`
- `mnemonic`
- `linkType` (ex: `valkyrie:application`, `BR:Playlist`, etc.)
- `version`
- `active`, `disabled`
- `created`, `published`, `updated`
- `moderationStatus`
- `lastActivatedDate`
- `discoveryIntent`
- `linkState`

Campos em `metadata` (varia por tipo, mas frequentemente inclui):

- Midia (thumb)
  - `metadata.image_url` (url principal)
  - `metadata.image_urls` (obj com tamanhos: `url_xs`, `url_s`, `url_m`, `url`)
  - Observado:
    - Ilhas podem usar CDN `qstv.on.epicgames.com` com `landscape_comp*.jpeg`
    - Playlists podem usar `cdn2.unrealengine.com/*.jpg`
- Texto / Card
  - `metadata.title`
  - `metadata.tagline`
  - `metadata.introduction`
  - `metadata.locale`
  - `metadata.machineTranslationPreferences.*`
- Jogo / Matchmaking
  - `metadata.matchmakingV2.maxPlayers/minPlayers/maxSocialPartySize/...`
- Ratings
  - `metadata.ratings.boards.*` (ESRB/PEGI/USK/ClassInd/Generic/etc)
- Outros (dependendo do tipo)
  - `metadata.supportCode` (creator code)
  - `metadata.video_vuid` / `extra_video_vuids`
  - `metadata.extra_image_urls[]` (screenshots)

---

## 3) Exemplos reais observados

### 3.1 Ilha UEFN (mnemonic `4826-5238-3419`)

- `metadata.image_url`:
  - `https://cdn-0001.qstv.on.epicgames.com/<id>/image/landscape_comp.jpeg`
- `metadata.image_urls.url_s`:
  - `.../landscape_comp_s.jpeg`
- `metadata.matchmakingV2.maxPlayers` etc presentes
- `updated` e `created/published` presentes
- `metadata.ratings.boards.*` por board presentes

### 3.2 Playlist (mnemonic `playlist_trios`)

- `metadata.image_url`:
  - `https://cdn2.unrealengine.com/...jpg`
- `metadata.image_urls.url_xs/url_s/url_m/url` presentes
- `dynamicXp` pode aparecer
- `updated` pode ser antigo (depende do asset)

---

## 4) Como usar isso no produto (dados e features)

### 4.1 Dados a coletar (colunas normalizadas recomendadas)

Minimo que vale ouro:

- `link_code` (pk)
- `link_type`
- `account_id`
- `creator_name`
- `support_code`
- `title`
- `image_url`
- `image_urls` (JSONB opcional)
- `updated_at_epic` (campo `updated` do response)
- `version`
- `moderation_status`
- `link_state`
- `active`, `disabled`
- `max_players`, `min_players` (de `matchmakingV2`)

Mais dados (quando existir):

- `tagline`, `introduction`, `locale`
- `ratings` (JSONB ou normalizado por board)
- `extra_image_urls` (JSONB)
- `video_vuid` (TEXT)

### 4.2 Deteccao de mudancas (events)

Criar eventos quando:

- `image_url` mudou => `thumb_changed`
- `title` mudou => `title_changed`
- `updated` aumentou => `link_updated` (ou `map_updated` quando for ilha)
- `moderationStatus/linkState` mudou => `moderation_changed`

Isso alimenta:

- timeline de updates por ilha
- comparacao antes/depois (ex: apos trocar thumb, mudou exposicao/CCU?)

### 4.3 Enriquecimento de Exposure + Reports

- Ao renderizar exposure/timeline, fazer join com metadata para:
  - mostrar title/thumb
  - tooltips com maxPlayers, ratings, last update, etc.
- No report semanal/mensal:
  - "ilhas que mais atualizaram" vs "ilhas estaveis"
  - "efeito update" (mudanca de rank/minutos expostos e CCU apos `updated`)
  - filtros por ratings (family-friendly vs mature), por regiao/board

---

## 5) Pipeline recomendado (operacao 24/7)

### 5.1 Cache novo (recomendado)

Nao limitar a `discover_islands_cache` (que e so ilhas). Criar um cache por `link_code` para cobrir:

- ilhas `dddd-dddd-dddd`
- `playlist_*`
- `reference_*`
- `ref_panel_*`

Motivo:

- Homebar e outros panels podem listar referencias/collections; elas tambem precisam de title/thumb.
- Evita misturar sinal de metrics (semanal) com metadata de cards.

### 5.2 Como atualizar (prioridade)

- Sempre que um `link_code` aparecer no exposure (tick ok), enfileirar para refresh (best-effort).
- Regras de refresh:
  - "premium" (Homebar/Trending/EpicsPicks/TopRated etc): refresh mais frequente (ex: 1-2h)
  - resto: refresh diario (24h)
- Guard rails:
  - controlar taxa (rate limit) e retry/backoff para 429/5xx
  - armazenar `last_fetched_at` e `next_due_at`

### 5.3 Bulk

O repo de docs menciona bulk via POST, mas no teste local o bulk retornou `400 Failed to read request`.
Na pratica, o GET individual funcionou `200` e ja e suficiente para iniciar. Depois vale revalidar o formato do bulk e/ou usar fila/worker com GET em batch controlado.

---

## 6) Como isso se conecta com "A/B"

O "A/B" que aparece no Discovery V2 e o da surface:

- `testVariantName`, `testName`, `testAnalyticsId`, `testVariantAnalyticsId`

Isso e experimento de discovery/ranking, nao "AB do mapa".

Para "AB do mapa" (thumb/title), o caminho e inferencia:

- detectar mudanca em `metadata.image_url` / `metadata.title` ao longo do tempo

---

## 7) Comandos de teste local (referencia rapida)

Assumindo que voce ja tem `$access` valido:

Ilha:

```powershell
curl.exe -sS -i --max-time 20 "https://links-public-service-live.ol.epicgames.com/links/api/fn/mnemonic/4826-5238-3419" `
  -H "Authorization: Bearer $access" `
  -H "Accept: application/json"
```

Playlist:

```powershell
curl.exe -sS -i --max-time 20 "https://links-public-service-live.ol.epicgames.com/links/api/fn/mnemonic/playlist_trios" `
  -H "Authorization: Bearer $access" `
  -H "Accept: application/json"
```

