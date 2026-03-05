import fs from 'node:fs';
import path from 'node:path';

function loadEnv(file = '.env') {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

const env = { ...loadEnv('.env'), ...process.env };
const OPENROUTER_API_KEY = (env.OPENROUTER_API_KEY || '').trim();
const SUPABASE_URL = (env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing');

const INTENT_MODEL = (env.TGIS_INTENT_MODEL || 'openai/gpt-4o').trim();
const EPIC_POLICY_CONSTRAINTS =
  'EPIC GAMES CONTENT POLICY - MANDATORY COMPLIANCE: ' +
  'Absolutely no real-world currency: no dollar bills, no banknotes, no paper money, no currency symbols ($, EUR, GBP, BRL, JPY) of any kind. ' +
  'No V-Bucks symbols or Battle Pass references. ' +
  'No XP text, numbers, or progress bar UI elements. ' +
  'No Epic Games logos, product names, or branded assets. ' +
  'No console controller buttons (A/B/X/Y, L2/R2, triggers). ' +
  'No photographs or realistic depictions of real people. ' +
  'No alcohol bottles, drug paraphernalia, or gambling equipment. ' +
  'No violent gore, realistic blood, or disturbing imagery. ' +
  'No sexually suggestive poses or content. ' +
  'No URLs, social media handles, or external references. ' +
  'Stylized in-game gold coins are acceptable. Real-world banknotes and currency symbols are not.';
const TEXT_NEGATIVE_CONSTRAINTS =
  'no text, no titles, no numbers, no logos, no UI overlays, no HUD elements anywhere in the image';

const normalizeText = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const normalizeTag = (v) => normalizeText(v).toLowerCase();
const normalizeSlug = (v) => normalizeTag(v).replace(/[^a-z0-9_\- ]+/g, '').replace(/[\s-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
const compactForMatch = (v) => normalizeTag(v).replace(/[\s_-]+/g, '');
const hasAnyKeyword = (values, keywords) => {
  const blob = compactForMatch(values.join(' '));
  return keywords.some((k) => blob.includes(compactForMatch(k)));
};

function parseJsonObjectFromText(raw) {
  const text = normalizeText(raw);
  if (!text) return null;
  try { const p = JSON.parse(text); if (p && typeof p === 'object' && !Array.isArray(p)) return p; } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) { try { const p = JSON.parse(fenced[1].trim()); if (p && typeof p === 'object' && !Array.isArray(p)) return p; } catch {} }
  const first = text.indexOf('{'); const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) { try { const p = JSON.parse(text.slice(first, last + 1)); if (p && typeof p === 'object' && !Array.isArray(p)) return p; } catch {} }
  return null;
}

function sanitizeUserIntentText(input) {
  let text = normalizeText(input);
  const original = text;
  const changes = [];
  const replaceRule = (rule, pattern, replacement) => {
    const matches = text.match(pattern);
    if (!matches || matches.length === 0) return;
    const before = matches[0];
    const count = matches.length;
    text = text.replace(pattern, replacement);
    changes.push({ rule, before, after: replacement, count });
  };
  replaceRule('currency_dollar_bills', /\b(dollar bills?|usd bills?)\b/gi, 'stylized in-game gold coins and loot rewards');
  replaceRule('currency_banknotes', /\b(banknotes?|paper money)\b/gi, 'stylized in-game gold coins and loot rewards');
  replaceRule('currency_cash_money', /\bcash money\b/gi, 'stylized in-game gold coins and loot rewards');
  replaceRule('currency_cash', /\bcash\b(?!\s*registers?\b)/gi, 'stylized in-game gold coins and loot rewards');
  replaceRule('currency_symbol', /\$/g, 'gold coins');
  replaceRule('vbucks', /\b(v[\s-]?bucks?|vbucks?)\b/gi, 'in-game rewards');
  replaceRule('battle_pass', /\b(battle\s*pass)\b/gi, 'season progression rewards');
  replaceRule('xp', /\b(xp|experience\s*points?)\b/gi, 'progression energy');
  replaceRule(
    'violence_gore',
    /\b(blood|bloody|gore|gory|violent|violence|brutal|brutality|dismember(?:ed|ment)?|decapitat(?:e|ed|ion)|eviscerat(?:e|ed|ion))\b/gi,
    'non-graphic high-energy action',
  );
  replaceRule('map_code_numbers', /\b\d{4}-\d{4}\b/g, 'map reference');
  replaceRule('map_code_label', /\b(map code|island code)\b/gi, 'map reference');
  replaceRule('text_overlay_request', /\b(write|add|include|put|show)\b[^.]{0,100}\b(text|title|letters|numbers?)\b/gi, 'focus on visual action only');
  text = normalizeText(text);
  return { original_text: original, sanitized_text: text, changed: text !== original, changes };
}

function normalizeIntent(raw, fallbackDescription, tags) {
  const readString = (k, def) => normalizeText(raw[k] ?? def);
  const arr = Array.isArray(raw.environment_elements) ? raw.environment_elements : [];
  const env = arr.map((v) => normalizeText(v)).filter(Boolean).slice(0, 6);
  const fallbackEnv = tags.slice(0, 4).map((t) => t.replace(/_/g, ' '));
  return {
    main_subject_action: readString('main_subject_action', fallbackDescription || 'Dynamic gameplay action with strong readability.'),
    environment_elements: env.length ? env : fallbackEnv.length ? fallbackEnv : ['Fortnite Creative environment elements'],
    composition_style: readString('composition_style', 'dynamic diagonal composition with clear focal hierarchy'),
    color_emphasis: readString('color_emphasis', 'vibrant saturated Fortnite palette with high contrast'),
    character_pose: readString('character_pose', 'confident action-ready pose with strong silhouette clarity'),
    depth_layers: readString('depth_layers', 'foreground hero subject, readable midground action, contextual background'),
  };
}

function fallbackIntent(description, tags) {
  const lowered = normalizeTag(description);
  const compositionStyle = lowered.includes('center')
    ? 'centered composition with strong subject dominance'
    : lowered.includes('rule of thirds')
      ? 'rule-of-thirds composition with clean visual balance'
      : lowered.includes('diagonal') || lowered.includes('dutch')
        ? 'dynamic diagonal composition with motion energy'
        : 'dynamic cinematic composition with clear focal hierarchy';
  return normalizeIntent({
    main_subject_action: description || 'Strong gameplay moment with immediate visual readability.',
    environment_elements: tags.slice(0, 4).map((t) => t.replace(/_/g, ' ')),
    composition_style: compositionStyle,
    color_emphasis: 'vibrant saturated Fortnite colors with controlled contrast',
    character_pose: 'clear action pose with readable silhouette',
    depth_layers: 'foreground subject, active midground, contextual background',
  }, description, tags);
}

function stripUiTextTerms(value) {
  let out = normalizeText(value);
  const rules = [
    [/\b(map code|island code)\b/gi, 'map context'],
    [/\b\d{4}-\d{4}\b/g, 'map reference'],
    [/\b(write|add|include|put|show)\b[^.]{0,100}\b(text|title|letters|numbers?)\b/gi, 'focus on visual action only'],
    [/\b(text|title|logo|overlay|hud|ui|watermark|code in corner)\b/gi, ''],
  ];
  for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement);
  return normalizeText(out);
}

function enforceClusterIntentCompatibility({ clusterSlug, tags, intent }) {
  const slug = normalizeSlug(clusterSlug || '');
  const tagBlob = tags.map((t) => normalizeTag(t));
  const isTycoon = slug.includes('tycoon') || hasAnyKeyword(tagBlob, ['tycoon', 'simulator']);
  const isDuel = hasAnyKeyword([slug, ...tagBlob], ['1v1', 'boxfight', 'zonewars', 'pvp', 'duel']);

  const cleanText = (v) => stripUiTextTerms(v);
  const cleanedEnv = intent.environment_elements.map((e) => cleanText(e)).filter(Boolean);

  const horrorTerms = ['zombie', 'blood', 'gore', 'apocalypse', 'horror', 'terrifying', 'scary', 'foggy horror'];
  const tycoonIncompatibleColorTerms = ['dark','black','blood','crimson','gore','horror','eerie','grim','desaturated','washed out','muted'];
  const tycoonIncompatibleDepthTerms = ['zombie','undead','monster','blood','fog','apocalypse','horror','grave','corpse','nightmare','ruins','destroyed city'];
  const tycoonColorDefault = 'bright saturated warm-gold palette with clean sky/cool accents and high contrast readability';
  const tycoonDepthDefault = 'foreground dominant hero subject, midground progression machines/upgrades, and background rich tycoon skyline with reward context';
  const peacefulTerms = ['peaceful sunset beach', 'cute house', 'calm beach'];
  const hasTerm = (v, terms) => terms.some((t) => normalizeTag(v).includes(normalizeTag(t)));

  let mainAction = cleanText(intent.main_subject_action);
  let composition = cleanText(intent.composition_style);
  let color = cleanText(intent.color_emphasis);
  let pose = cleanText(intent.character_pose);
  let depth = cleanText(intent.depth_layers);
  let env = cleanedEnv.filter((e) => !hasTerm(e, ['map code', 'text in corner', 'big letters']));

  if (isTycoon) {
    const contradictionDetected =
      hasTerm(mainAction, horrorTerms) ||
      hasTerm(composition, horrorTerms) ||
      hasTerm(color, [...horrorTerms, ...tycoonIncompatibleColorTerms]) ||
      hasTerm(depth, [...horrorTerms, ...tycoonIncompatibleDepthTerms]) ||
      env.some((e) => hasTerm(e, horrorTerms));

    mainAction = hasTerm(mainAction, horrorTerms)
      ? 'Hero character showcasing progression and success in a rich tycoon environment'
      : mainAction;
    composition = hasTerm(composition, horrorTerms)
      ? 'dominant foreground hero with progression-rich background and readable economy fantasy'
      : composition;
    color = contradictionDetected ? tycoonColorDefault : color;
    pose = hasTerm(pose, horrorTerms) ? 'confident triumphant pose with readable silhouette' : pose;
    depth = contradictionDetected ? tycoonDepthDefault : depth;
    env = env.filter((e) => !hasTerm(e, horrorTerms));
    if (!env.length) env = ['gold coins', 'upgrade machines', 'factory/building progression', 'reward-rich background'];
  }

  if (isDuel) {
    if (hasTerm(mainAction, peacefulTerms)) {
      mainAction = 'Two players in direct competitive confrontation with clear action readability';
    }
    env = env.filter((e) => !hasTerm(e, ['beach', 'cute house', 'peaceful sunset']));
    if (!env.length) env = ['build ramp or edit structures', 'competitive arena', 'clear confrontation line'];
  }

  return normalizeIntent({
    main_subject_action: mainAction,
    environment_elements: env,
    composition_style: composition,
    color_emphasis: color,
    character_pose: pose,
    depth_layers: depth,
  }, mainAction || intent.main_subject_action, tags);
}

async function processUserIntent({ description, mapTitle, tags, clusterSlug, clusterFamily }) {
  const desc = normalizeText(description);
  const tgs = tags.map((t) => normalizeTag(t)).filter(Boolean);
  const fallback = fallbackIntent(desc, tgs);

  const systemPrompt =
    'You are a visual composition assistant for Fortnite Creative thumbnails. ' +
    'Extract structured visual intent from user input. ' +
    'IMPORTANT COMPLIANCE RULE: if user mentions real-world currency, V-Bucks, Battle Pass, XP, convert them to safe in-game equivalents. Never keep disallowed terms. ' +
    'Ignore and remove any request for text, titles, numbers, logos, map codes, UI, HUD, overlays, or watermarks. ' +
    'If the user intent conflicts with the cluster genre, adapt to a cluster-compatible visual direction while preserving useful composition hints. ' +
    'Return only valid JSON with fields: main_subject_action (string), environment_elements (string array), composition_style (string), color_emphasis (string), character_pose (string), depth_layers (string).';

  const userPrompt = [
    `Cluster slug: ${normalizeText(clusterSlug || 'unknown')}`,
    `Cluster family: ${normalizeText(clusterFamily || 'unknown')}`,
    `Map title (context only): ${normalizeText(mapTitle || '') || 'n/a'}`,
    `Tags: ${tgs.join(', ') || 'n/a'}`,
    `User description: ${desc || 'n/a'}`,
  ].join('\n');

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: INTENT_MODEL, temperature: 0.2, max_tokens: 420, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      const enforced = enforceClusterIntentCompatibility({ clusterSlug, tags: tgs, intent: fallback });
      return { intent: enforced, provider: 'fallback', model: INTENT_MODEL, error: `intent_http_${resp.status}:${txt.slice(0,220)}` };
    }

    const payload = await resp.json();
    const raw = String(payload?.choices?.[0]?.message?.content || '');
    const parsed = parseJsonObjectFromText(raw);
    if (!parsed) {
      const enforced = enforceClusterIntentCompatibility({ clusterSlug, tags: tgs, intent: fallback });
      return { intent: enforced, provider: 'fallback', model: INTENT_MODEL, raw_response: raw.slice(0,1200), error: 'intent_invalid_json' };
    }

    const intent = enforceClusterIntentCompatibility({ clusterSlug, tags: tgs, intent: normalizeIntent(parsed, desc, tgs) });
    return { intent, provider: 'openrouter', model: INTENT_MODEL, raw_response: raw.slice(0,1200) };
  } catch (e) {
    const enforced = enforceClusterIntentCompatibility({ clusterSlug, tags: tgs, intent: fallback });
    return { intent: enforced, provider: 'fallback', model: INTENT_MODEL, error: String(e?.message || e) };
  }
}

function cameraInstruction(cameraAngle) {
  const key = normalizeSlug(cameraAngle || 'eye');
  if (key === 'low') return 'Low camera angle looking slightly upward, making characters appear powerful and dominant.';
  if (key === 'high') return 'High angle camera looking down, showing the full scene and environment.';
  if (key === 'dutch') return 'Dynamic dutch angle camera tilt, extreme energy and chaos, diagonal composition.';
  return 'Camera at eye level, direct and confrontational perspective.';
}

function inferMood(tags, moodOverride) {
  const overrideKey = normalizeSlug(moodOverride);
  if (overrideKey) {
    if (['intense', 'intense_competitive', 'competitive', 'high_energy'].includes(overrideKey)) return 'Fierce competitive atmosphere, dramatic rim lighting, high tension.';
    if (['epic', 'epic_cinematic', 'cinematic'].includes(overrideKey)) return 'Vibrant cinematic atmosphere, strong contrast, premium action readability.';
    if (['fun', 'fun_playful'].includes(overrideKey)) return 'Energetic playful mood, dynamic movement, bright vivid colors.';
    if (['dark', 'dark_horror', 'scary', 'horror'].includes(overrideKey)) return 'Dark moody atmosphere, deep shadows, fog, eerie lighting.';
    if (['chill', 'clean', 'clean_minimal'].includes(overrideKey)) return 'Relaxed friendly atmosphere, soft warm lighting, inviting composition.';
  }
  if (hasAnyKeyword(tags, ['1v1', 'pvp', 'boxfight', 'zonewars', 'zone wars'])) return 'Fierce competitive atmosphere, dramatic rim lighting, high tension.';
  if (hasAnyKeyword(tags, ['tycoon', 'simulator'])) return 'Vibrant cheerful energy, bright saturated colors, abundant and exciting.';
  return 'Vibrant cinematic atmosphere, strong contrast, premium action readability.';
}

function isDuelCluster(cluster, tags) {
  const keys = [cluster.cluster_slug || '', cluster.cluster_family || '', ...tags];
  return hasAnyKeyword(keys, ['1v1', 'boxfight', 'box fight', 'zonewars', 'zone wars', 'duel', 'pvp']);
}

function deriveSceneType(cluster, tags) {
  const keys = [cluster.cluster_slug || '', cluster.cluster_family || '', ...tags];
  if (hasAnyKeyword(keys, ['1v1', 'boxfight', 'box fight', 'zonewars', 'zone wars', 'duel', 'pvp'])) {
    return 'Fortnite Creative duel thumbnail';
  }
  if (hasAnyKeyword(keys, ['tycoon', 'simulator'])) {
    return 'Fortnite Creative tycoon thumbnail';
  }
  if (hasAnyKeyword(keys, ['horror', 'survival_horror', 'backrooms'])) {
    return 'Fortnite Creative horror thumbnail';
  }
  if (hasAnyKeyword(keys, ['deathrun', 'parkour', 'race'])) {
    return 'Fortnite Creative challenge thumbnail';
  }
  return 'Fortnite Creative gameplay thumbnail';
}

function fallbackDepthLayers(cluster, tags) {
  const keys = [cluster.cluster_slug || '', cluster.cluster_family || '', ...tags];
  if (hasAnyKeyword(keys, ['tycoon', 'simulator'])) {
    return {
      foreground: 'dominant hero character with triumphant pose and reward cues',
      midground: 'progression machines, upgrades, and readable gameplay economy elements',
      background: 'rich tycoon skyline and contextual environment',
    };
  }
  if (hasAnyKeyword(keys, ['1v1', 'boxfight', 'zonewars', 'duel', 'pvp'])) {
    return {
      foreground: 'dominant player action with clear confrontation',
      midground: 'build/edit structures and tactical movement space',
      background: 'opposing subject and arena context',
    };
  }
  return {
    foreground: 'dominant gameplay subject with clear silhouette',
    midground: 'supporting action elements with readable structure',
    background: 'contextual environment and depth cues',
  };
}

function parseDepthLayersText(rawDepth) {
  const raw = normalizeText(rawDepth);
  if (!raw) return {};
  const out = {};
  const parts = raw
    .split(/[,;]+/)
    .map((p) => normalizeText(p))
    .filter(Boolean);

  for (const part of parts) {
    const low = normalizeTag(part);
    if (low.startsWith('foreground')) {
      out.foreground = normalizeText(part.replace(/^foreground(?:\s*(?:with|:|-)\s*)?/i, '')) || 'foreground gameplay subject';
      continue;
    }
    if (low.startsWith('midground')) {
      out.midground = normalizeText(part.replace(/^midground(?:\s*(?:with|:|-)\s*)?/i, '')) || 'midground gameplay context';
      continue;
    }
    if (low.startsWith('background')) {
      out.background = normalizeText(part.replace(/^background(?:\s*(?:with|:|-)\s*)?/i, '')) || 'background environment context';
      continue;
    }
  }
  return out;
}

function buildDepthLayers(args) {
  const fallback = fallbackDepthLayers(args.cluster, args.tags);
  const parsed = parseDepthLayersText(args.processedIntent.depth_layers);
  const mainAction = normalizeText(args.processedIntent.main_subject_action);

  let foreground = normalizeText(parsed.foreground || fallback.foreground);
  if (mainAction) foreground = mainAction;
  let midground = normalizeText(parsed.midground || fallback.midground);
  let background = normalizeText(parsed.background || fallback.background);

  const primaryName = normalizeText(args.skinContexts[0]?.name || '');
  const secondaryName = normalizeText(args.skinContexts[1]?.name || '');
  if (primaryName && !normalizeTag(foreground).includes(normalizeTag(primaryName))) {
    foreground = `${primaryName} as dominant foreground subject. ${foreground}`;
  }
  if (secondaryName && !normalizeTag(background).includes(normalizeTag(secondaryName))) {
    background = `${secondaryName} as secondary/background subject. ${background}`;
  }

  return {
    foreground: normalizeText(foreground),
    midground: normalizeText(midground),
    background: normalizeText(background),
  };
}

function buildCharacters(args) {
  const duelCluster = isDuelCluster(args.cluster, args.tags);
  const pose = normalizeText(args.processedIntent.character_pose || 'clear action pose with readable silhouette');
  if (args.skinContexts.length >= 2) {
    const p = args.skinContexts[0];
    const s = args.skinContexts[1];
    return {
      primary: {
        identity: `${p.name}: ${normalizeText(p.vision_text)}`,
        pose,
        position: 'dominant foreground left, large scale',
      },
      secondary: {
        identity: `${s.name}: ${normalizeText(s.vision_text)}`,
        pose: 'opposing action, readable at thumbnail size',
        position: 'background right, smaller scale',
      },
    };
  }
  if (args.skinContexts.length === 1) {
    const p = args.skinContexts[0];
    return {
      primary: {
        identity: `${p.name}: ${normalizeText(p.vision_text)}`,
        pose,
        position: duelCluster ? 'dominant foreground left, large scale' : 'dominant foreground, large scale',
      },
    };
  }
  return {
    primary: {
      identity: 'generic Fortnite character, no fixed skin',
      pose: 'action-ready pose with clear silhouette readability, aligned with foreground action',
      position: duelCluster ? 'dominant foreground, large scale with clear confrontation line' : 'dominant foreground, large scale',
    },
  };
}

function buildPhotography(cameraAngle, processedIntent) {
  return {
    style: 'Fortnite cinematic 3D render, vibrant saturated art style',
    aspect_ratio: '16:9 widescreen 1920x1080',
    camera_angle: cameraInstruction(cameraAngle),
    depth_of_field: 'shallow, strong foreground-midground-background separation',
    color_grading: 'vibrant, high saturation, cinematic contrast',
  };
}

function buildPromptJson(args) {
  const templateResolved = args.template.template_text;
  const elements = args.processedIntent.environment_elements
    .map((e) => normalizeText(e))
    .filter(Boolean);
  const sceneType = deriveSceneType(args.cluster, args.tags);
  const compositionStyle = normalizeText(args.processedIntent.composition_style || 'dynamic cinematic composition');
  const colorPalette = normalizeText(args.processedIntent.color_emphasis || 'vibrant saturated Fortnite palette');

  return {
    scene: {
      type: sceneType,
      composition: normalizeText(templateResolved),
      depth_layers: buildDepthLayers({
        processedIntent: args.processedIntent,
        cluster: args.cluster,
        tags: args.tags,
        skinContexts: args.skinContexts,
      }),
    },
    characters: buildCharacters({
      skinContexts: args.skinContexts,
      processedIntent: args.processedIntent,
      cluster: args.cluster,
      tags: args.tags,
    }),
    environment: {
      elements: elements.length ? elements : ['Fortnite Creative gameplay environment with clean readability'],
      color_palette: colorPalette,
      composition_style: compositionStyle,
    },
    photography: buildPhotography(args.cameraAngle, args.processedIntent),
    mood: normalizeText(args.mood),
    negative: {
      text_elements: TEXT_NEGATIVE_CONSTRAINTS,
      epic_policy: EPIC_POLICY_CONSTRAINTS,
    },
  };
}

function validatePromptJson(value) {
  const fail = (reason) => ({ ok: false, reason });
  if (!value || typeof value !== 'object') return fail('root_not_object');
  if (!value.scene || typeof value.scene !== 'object') return fail('missing_scene');
  if (!value.characters || typeof value.characters !== 'object') return fail('missing_characters');
  if (!value.environment || typeof value.environment !== 'object') return fail('missing_environment');
  if (!value.photography || typeof value.photography !== 'object') return fail('missing_photography');
  if (!normalizeText(value.mood)) return fail('missing_mood');
  if (!value.negative || typeof value.negative !== 'object') return fail('missing_negative');
  if (!normalizeText(value.negative.epic_policy)) return fail('missing_negative_epic_policy');

  const depth = value.scene.depth_layers;
  if (!depth || typeof depth !== 'object') return fail('missing_scene_depth_layers');
  if (!normalizeText(depth.foreground)) return fail('missing_scene_depth_layers_foreground');
  if (!normalizeText(depth.midground)) return fail('missing_scene_depth_layers_midground');
  if (!normalizeText(depth.background)) return fail('missing_scene_depth_layers_background');

  const primary = value.characters.primary;
  if (!primary || typeof primary !== 'object') return fail('missing_characters_primary');
  if (!normalizeText(primary.identity)) return fail('missing_characters_primary_identity');
  if (!normalizeText(primary.pose)) return fail('missing_characters_primary_pose');
  if (!normalizeText(primary.position)) return fail('missing_characters_primary_position');

  if (value.characters.secondary) {
    const secondary = value.characters.secondary;
    if (!normalizeText(secondary.identity)) return fail('missing_characters_secondary_identity');
    if (!normalizeText(secondary.pose)) return fail('missing_characters_secondary_pose');
    if (!normalizeText(secondary.position)) return fail('missing_characters_secondary_position');
  }

  if (!Array.isArray(value.environment.elements) || value.environment.elements.length === 0) {
    return fail('missing_environment_elements');
  }
  if (!normalizeText(value.environment.color_palette)) return fail('missing_environment_color_palette');
  if (!normalizeText(value.environment.composition_style)) return fail('missing_environment_composition_style');
  if (!normalizeText(value.photography.style)) return fail('missing_photography_style');
  if (!normalizeText(value.photography.aspect_ratio)) return fail('missing_photography_aspect_ratio');
  if (!normalizeText(value.photography.camera_angle)) return fail('missing_photography_camera_angle');
  if (!normalizeText(value.photography.depth_of_field)) return fail('missing_photography_depth_of_field');
  if (!normalizeText(value.photography.color_grading)) return fail('missing_photography_color_grading');

  const asText = JSON.stringify(value).toLowerCase();
  const forbiddenLegacyFragments = ['reference mapping', 'reference policy', 'tag context', 'composition rules'];
  if (forbiddenLegacyFragments.some((x) => asText.includes(x))) {
    return fail('legacy_prompt_fragment_detected');
  }

  return { ok: true, reason: null };
}

async function getTemplates() {
  const fallback = {
    '1v1': 'Fortnite Creative duel thumbnail. Position two characters in the foreground, one on the left aiming towards the right, creating a confrontation line. Ensure the dominant character is larger and more detailed, while the opposing character is readable but less prominent. Use a slightly low camera angle to emphasize the action, with a vibrant background to enhance the scene\'s energy and depth. Two opposing players with strong action readability and a clear confrontation line.',
    'tycoon': 'Fortnite Creative tycoon thumbnail. A dominant hero character in the foreground with clear triumphant energy and strong silhouette readability. Background must show progression-rich tycoon environment (factories/shops/upgrades/reward ecosystem) with strong depth layering from foreground to horizon. Use bright saturated warm-gold palette balanced with clean sky/cool accents, cinematic contrast, and high visual clarity at thumbnail size. Prioritize reward fantasy, abundance cues, and a single clear focal hierarchy without split-screen layout or text-based focal elements.',
  };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return fallback;
  const url = `${SUPABASE_URL}/rest/v1/tgis_prompt_templates?select=cluster_slug,template_text,is_active,updated_at&is_active=eq.true&cluster_slug=in.(1v1,tycoon)&order=updated_at.desc`;
  const resp = await fetch(url, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!resp.ok) return fallback;
  const rows = await resp.json();
  const map = { ...fallback };
  for (const r of rows) {
    const s = normalizeSlug(r.cluster_slug);
    if (s && normalizeText(r.template_text) && map[s]) map[s] = normalizeText(r.template_text);
  }
  return map;
}

const cases = [
  { cluster: '1v1', id: '1v1_good_1', prompt: 'Fishstick foreground climbing a wooden ramp aggressively, looking back at the camera with intense eyes. Sweat running down. Peely on the opposite side of the ramp, smaller in background, reaching upward. Cyan sky, dramatic rim lighting on both characters.' },
  { cluster: '1v1', id: '1v1_good_2', prompt: 'Two players on a tall build ramp, one dominant in the foreground with aggressive climbing pose, the other in background racing to the top. High tension competitive feel, vivid blue sky, wooden structure center frame.' },
  { cluster: '1v1', id: '1v1_good_3', prompt: 'Intense 1v1 edit course battle. Hero character large on right side, turning head to look at opponent. Opponent smaller on left side going up fast. Dramatic lighting, sharp shadows, electric atmosphere.' },
  { cluster: '1v1', id: '1v1_bad_4', prompt: '1v1 map thumbnail please' },
  { cluster: '1v1', id: '1v1_bad_5', prompt: "My map has box fights and you earn XP when you win. It's really fun and has 3 rounds." },
  { cluster: '1v1', id: '1v1_bad_6', prompt: "Put the map code 1234-5678 in the corner and write '1v1' in big letters in the center." },
  { cluster: '1v1', id: '1v1_bad_7', prompt: 'Winner gets a prize, show cash money and dollar bills falling from the sky.' },
  { cluster: '1v1', id: '1v1_bad_8', prompt: 'Peaceful sunset beach with palm trees and a cute house.' },
  { cluster: 'tycoon', id: 'tycoon_good_1', prompt: 'Fishstick sitting on a mountain of oversized gold coins, relaxed triumphant pose. Background has tall luxury skyscrapers and floating shop upgrade icons. Bright gold and sky blue palette, diagonal upward composition, money bags scattered around.' },
  { cluster: 'tycoon', id: 'tycoon_good_2', prompt: 'Burger restaurant tycoon. Character in foreground with chef hat, smiling big. Background shows giant burger factory with conveyor belts, stacks of burgers everywhere, golden coins raining down. Warm oranges and yellows, fun vibrant energy.' },
  { cluster: 'tycoon', id: 'tycoon_good_3', prompt: 'Space tycoon. Hero character in astronaut suit foreground center, arms open wide. Background has huge space station under construction, floating asteroids with gold veins, rocket ships launching. Deep purple and gold palette, epic scale.' },
  { cluster: 'tycoon', id: 'tycoon_good_4', prompt: 'Shopping mall tycoon. Character foreground smiling, giant mall with neon signs in background, gold coins and cash registers floating everywhere. Bright colorful, happy mood.' },
  { cluster: 'tycoon', id: 'tycoon_bad_5', prompt: 'Tycoon island thumbnail' },
  { cluster: 'tycoon', id: 'tycoon_bad_6', prompt: 'Players collect resources and build their shop. Every 30 seconds you get coins to upgrade. Has 5 upgrade levels.' },
  { cluster: 'tycoon', id: 'tycoon_bad_7', prompt: 'Character holding V-Bucks and showing XP bar filling up. Dollar bills everywhere showing how much money you can earn.' },
  { cluster: 'tycoon', id: 'tycoon_bad_8', prompt: 'Escape Lava From Brainrot' },
  { cluster: 'tycoon', id: 'tycoon_bad_9', prompt: 'Dark scary zombie apocalypse with blood and horror atmosphere.' },
];

const templates = await getTemplates();
const out = [];
const failures = [];
for (const c of cases) {
  const tags = c.cluster === '1v1' ? ['1v1','pvp','boxfight'] : ['tycoon','simulator'];
  const cluster = {
    cluster_id: c.cluster === '1v1' ? 21 : 2,
    cluster_name: c.cluster,
    cluster_slug: c.cluster,
    cluster_family: c.cluster === '1v1' ? 'combat' : 'tycoon',
  };

  const sanitization = sanitizeUserIntentText(c.prompt);
  const intent = await processUserIntent({
    description: sanitization.sanitized_text,
    mapTitle: '',
    tags,
    clusterSlug: cluster.cluster_slug,
    clusterFamily: cluster.cluster_family,
  });

  const promptJson = buildPromptJson({
    template: { template_text: templates[c.cluster] },
    cluster,
    tags,
    cameraAngle: 'eye',
    mood: inferMood(tags, ''),
    processedIntent: intent.intent,
    skinContexts: [],
  });
  const promptValidation = validatePromptJson(promptJson);
  const finalPrompt = JSON.stringify(promptJson);
  let parseError = null;
  let parsed = null;
  try {
    parsed = JSON.parse(finalPrompt);
  } catch (e) {
    parseError = String(e?.message || e);
  }

  const requiredRootFields = ['scene', 'characters', 'environment', 'photography', 'mood', 'negative'];
  const requiredFieldsOk = requiredRootFields.every((field) => parsed && Object.prototype.hasOwnProperty.call(parsed, field));
  const hasEpicPolicy = Boolean(parsed?.negative?.epic_policy && normalizeText(parsed.negative.epic_policy));
  const hasDepthLayers = Boolean(
    parsed?.scene?.depth_layers?.foreground &&
    parsed?.scene?.depth_layers?.midground &&
    parsed?.scene?.depth_layers?.background,
  );
  const legacyFragments = ['Reference mapping', 'Reference policy', 'Tag context', 'Composition rules']
    .filter((fragment) => finalPrompt.toLowerCase().includes(fragment.toLowerCase()));

  if (!promptValidation.ok || parseError || !requiredFieldsOk || !hasEpicPolicy || !hasDepthLayers || legacyFragments.length) {
    failures.push({
      id: c.id,
      reason: promptValidation.ok ? null : promptValidation.reason,
      parse_error: parseError,
      required_fields_ok: requiredFieldsOk,
      has_epic_policy: hasEpicPolicy,
      has_depth_layers: hasDepthLayers,
      legacy_fragments: legacyFragments,
    });
  }

  out.push({
    id: c.id,
    cluster: c.cluster,
    input_prompt: c.prompt,
    sanitization_report: sanitization,
    processed_intent_json: intent.intent,
    intent_provider: intent.provider,
    intent_model: intent.model,
    intent_error: intent.error || null,
    template_source: 'db',
    template_version: 'v1_generated',
    prompt_json_validation: {
      ...promptValidation,
      parse_error: parseError,
      required_fields_ok: requiredFieldsOk,
      has_epic_policy: hasEpicPolicy,
      has_depth_layers: hasDepthLayers,
      legacy_fragments: legacyFragments,
    },
    final_prompt: finalPrompt,
  });
}

const payload = { generated_at: new Date().toISOString(), model: INTENT_MODEL, total_cases: out.length, cases: out };
const outPath = path.join('ml','tgis','artifacts','prompt_engine_test_cases.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
}
console.log(JSON.stringify({ ok: failures.length === 0, output: outPath, total_cases: out.length, failures: failures.length }, null, 2));
