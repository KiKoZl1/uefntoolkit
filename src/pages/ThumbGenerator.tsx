import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Sparkles, Loader2, Download, X, ImagePlus, Globe, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import { useThumbTools } from "@/features/tgis-thumb-tools/ThumbToolsProvider";
import type { TgisGenerateResponse } from "@/types/tgis";

type SkinSearchItem = {
  id: string;
  name: string;
  rarity: string;
  image_url: string;
};

const PROMPT_MAX = 2000;
const TAGS_MAX = 24;
const SKIN_RESULT_LIMIT = 100;
const TAG_OPTIONS = [
  "Tycoon",
  "Horror",
  "Prop Hunt",
  "Deathrun",
  "Fashion",
  "1v1",
  "2v2",
  "3v3",
  "Board Game",
  "Boxfight",
  "Escape",
  "Free For All",
  "Gun Game",
  "Party Game",
  "Pvp",
  "Race",
  "Roguelike",
  "Role Playing",
  "Simulator",
  "Sniper",
  "Zonewars",
  "Bedwars",
  "Red Vs Blue",
] as const;

const MOOD_OPTIONS = [
  { id: "intense", label: "Intense" },
  { id: "epic", label: "Epic" },
  { id: "fun", label: "Fun" },
  { id: "chill", label: "Chill" },
  { id: "dark", label: "Dark" },
  { id: "cinematic", label: "Cinematic" },
];

const CAMERA_OPTIONS = [
  {
    id: "low",
    label: "Low Angle",
    description: "Camera baixa olhando para cima: personagens parecem mais poderosos e dominantes.",
  },
  {
    id: "eye",
    label: "Eye Level",
    description: "Camera na altura dos olhos: confronto direto, leitura limpa e equilibrada da cena.",
  },
  {
    id: "high",
    label: "High Angle",
    description: "Camera alta olhando para baixo: mostra melhor o cenário e a distribuicao da arena.",
  },
  {
    id: "dutch",
    label: "Dutch Angle",
    description: "Camera inclinada (dutch): energia extrema, caos e composicao diagonal dinamica.",
  },
] as const;

type CameraValue = (typeof CAMERA_OPTIONS)[number]["id"];
type StyleModeValue = "3d_cinematic_stylized" | "3d_cinematic_cartoon" | "2d_flat_illustration";

const STYLE_MODE_OPTIONS: Array<{ id: StyleModeValue; label: string }> = [
  { id: "3d_cinematic_stylized", label: "3D Stylized" },
  { id: "3d_cinematic_cartoon", label: "3D Cartoon" },
  { id: "2d_flat_illustration", label: "2D Flat" },
];

async function invokeSkinSearch(q: string, limit = SKIN_RESULT_LIMIT): Promise<SkinSearchItem[]> {
  const { data, error } = await supabase.functions.invoke("tgis-skins-search", {
    body: { q, limit, page: 1 },
  });

  if (error || data?.success === false) return [];
  return Array.isArray(data?.items) ? data.items : [];
}

export default function ThumbGenerator() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { registerAsset } = useThumbTools();
  const [loading, setLoading] = useState(false);
  const [rewritingPrompt, setRewritingPrompt] = useState(false);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [searchingSkins, setSearchingSkins] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [cameraAngle, setCameraAngle] = useState<CameraValue>("eye");
  const [moodOverride, setMoodOverride] = useState("");
  const [styleMode, setStyleMode] = useState<StyleModeValue | "">("");
  const [contextBoost, setContextBoost] = useState(true);
  const [maxSkinRefs, setMaxSkinRefs] = useState(2);
  const [selectedTags, setSelectedTags] = useState<string[]>([TAG_OPTIONS[0]]);

  const [skinQuery, setSkinQuery] = useState("");
  const [skinResults, setSkinResults] = useState<SkinSearchItem[]>([]);
  const [selectedSkins, setSelectedSkins] = useState<SkinSearchItem[]>([]);

  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string>("");

  const [result, setResult] = useState<TgisGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [loadingElapsedSec, setLoadingElapsedSec] = useState(0);
  const [rewriteOriginalPrompt, setRewriteOriginalPrompt] = useState<string | null>(null);
  const [rewriteApplied, setRewriteApplied] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await (supabase as any)
        .from("tgis_runtime_config")
        .select("context_boost_default,max_skin_refs")
        .eq("config_key", "default")
        .limit(1);
      if (!mounted) return;

      const row = Array.isArray(data) && data[0] ? data[0] : null;
      if (row && typeof row.context_boost_default === "boolean") {
        setContextBoost(Boolean(row.context_boost_default));
      }
      const maxRefs = Number(row?.max_skin_refs);
      if (Number.isFinite(maxRefs)) {
        setMaxSkinRefs(Math.max(0, Math.min(2, Math.floor(maxRefs))));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setLoadingElapsedSec(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setLoadingElapsedSec(Math.max(1, Math.floor((Date.now() - started) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [loading]);

  const tags = useMemo(() => {
    const base = selectedTags.map((x) => String(x || "").trim()).filter(Boolean);
    return Array.from(new Set(base)).slice(0, TAGS_MAX);
  }, [selectedTags]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchingSkins(true);

      const rawQuery = skinQuery.trim();
      const items = await invokeSkinSearch(rawQuery);

      if (cancelled) return;
      setSkinResults(items);
      setSearchingSkins(false);
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [skinQuery]);

  useEffect(() => {
    return () => {
      if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    };
  }, [referencePreviewUrl]);

  function onSelectReferenceFile(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0] || null;
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    setReferenceFile(file);
    setReferencePreviewUrl(file ? URL.createObjectURL(file) : "");
  }

  async function uploadReferenceIfNeeded(): Promise<string | null> {
    if (!referenceFile) return null;

    setUploadingRef(true);
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user?.id) throw new Error("missing_user_session_for_reference_upload");
      const uid = userRes.user.id;
      const safeName = referenceFile.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `${uid}/${Date.now()}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("tgis-user-references")
        .upload(path, referenceFile, {
          upsert: false,
          contentType: referenceFile.type || "image/jpeg",
        });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from("tgis-user-references").getPublicUrl(path);
      return data.publicUrl;
    } finally {
      setUploadingRef(false);
    }
  }

  function toggleSkin(item: SkinSearchItem) {
    const exists = selectedSkins.some((x) => x.id === item.id);
    if (exists) {
      setSelectedSkins((prev) => prev.filter((x) => x.id !== item.id));
      return;
    }

    if (selectedSkins.length >= maxSkinRefs) {
      toast({ title: `Limite de ${maxSkinRefs} skins por geracao.` });
      return;
    }
    setSelectedSkins((prev) => [...prev, item]);
  }

  function toggleTag(tag: string) {
    const normalized = String(tag || "").trim();
    if (!normalized) return;
    setSelectedTags((prev) =>
      prev.includes(normalized) ? prev.filter((x) => x !== normalized) : [...prev, normalized].slice(0, TAGS_MAX),
    );
  }

  async function handleGenerate(ev?: FormEvent) {
    ev?.preventDefault();
    setError(null);
    setResult(null);

    if (!prompt.trim()) {
      setError("Prompt e obrigatorio.");
      return;
    }
    if (tags.length === 0) {
      setError("Selecione pelo menos uma tag.");
      return;
    }

    setLoading(true);
    let referenceImageUrl: string | null = null;
    try {
      referenceImageUrl = await uploadReferenceIfNeeded();
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    const { data, error } = await supabase.functions.invoke("tgis-generate", {
      body: {
        prompt: prompt.trim(),
        tags,
        cameraAngle,
        moodOverride: moodOverride || undefined,
        styleMode: styleMode || undefined,
        skinIds: selectedSkins.map((x) => x.id),
        referenceImageUrl: referenceImageUrl || undefined,
        contextBoost,
      },
    });
    setLoading(false);

    if (error || data?.success === false) {
      setError(error?.message || data?.error || "Falha na geracao.");
      return;
    }

    const payload = data as TgisGenerateResponse;
    setResult(payload);

    const assetId = String(payload.asset_id || "").trim();
    if (assetId) {
      const { data: row } = await (supabase as any)
        .from("tgis_thumb_assets")
        .select("id,user_id,source_generation_id,parent_asset_id,origin_tool,image_url,width,height,metadata_json,created_at")
        .eq("id", assetId)
        .limit(1)
        .maybeSingle();
      if (row?.id) registerAsset(row as any);
    }
  }

  async function handleRewritePrompt() {
    if (rewriteApplied && rewriteOriginalPrompt != null) {
      setPrompt(rewriteOriginalPrompt);
      setRewriteApplied(false);
      setRewriteOriginalPrompt(null);
      setError(null);
      return;
    }

    if (!prompt.trim()) {
      setError("Escreva uma descricao antes de reescrever.");
      return;
    }

    const originalPrompt = prompt;
    setError(null);
    setRewritingPrompt(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const rewriteHeaders = sessionData?.session?.access_token
      ? { Authorization: `Bearer ${sessionData.session.access_token}` }
      : undefined;

    const { data, error } = await supabase.functions.invoke("tgis-rewrite-prompt", {
      headers: rewriteHeaders,
      body: {
        prompt: prompt.trim(),
        tags,
        cameraAngle,
        moodOverride: moodOverride || undefined,
        styleMode: styleMode || undefined,
      },
    });
    setRewritingPrompt(false);

    if (data?.error === "rewrite_rate_limited") {
      const retrySeconds = Number(data?.retry_after_seconds || 0);
      const retryMinutes = Math.max(1, Math.ceil(retrySeconds / 60));
      setError(`Limite de 10 melhorias por hora atingido. Tente novamente em ~${retryMinutes} min.`);
      return;
    }

    if (error || data?.success === false) {
      const emsg = String(error?.message || data?.error || "Falha ao reescrever prompt.");
      if (emsg.includes("rewrite_rate_limited")) {
        setError("Limite de 10 melhorias por hora atingido. Tente novamente em alguns minutos.");
      } else {
        setError(emsg);
      }
      return;
    }

    const rewritten = String(data?.prompt_rewritten || "").trim();
    if (!rewritten) {
      setError("Rewriter retornou vazio.");
      return;
    }

    setRewriteOriginalPrompt(originalPrompt);
    setRewriteApplied(true);
    setPrompt(rewritten.slice(0, PROMPT_MAX));
  }

  function downloadImage(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `tgis-thumb-${result?.generation_id || "image"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const resultUrl = result?.image?.url || result?.images?.[0]?.url || "";

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 px-6 py-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-bold">Thumb Generator</h1>
        <p className="text-sm text-muted-foreground">Create high-fidelity AI thumbnails for your maps</p>
      </header>

      <form onSubmit={handleGenerate} className="grid grid-cols-1 gap-5 md:grid-cols-12">
        <section className="space-y-5 md:col-span-8">
          <div className="space-y-3 rounded-xl border border-border/60 bg-card/25 p-4">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm font-semibold">Descreva a thumbnail desejada</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRewritePrompt}
                disabled={rewritingPrompt || loading || uploadingRef}
              >
                {rewritingPrompt ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {rewriteApplied ? t("thumbGenerator.undoButton") : t("thumbGenerator.improveButton")}
              </Button>
            </div>
            <Textarea
              value={prompt}
              maxLength={PROMPT_MAX}
              onChange={(e) => {
                setPrompt(e.target.value.slice(0, PROMPT_MAX));
              }}
              placeholder="Ex.: Uma batalha epica de Fortnite Creative, foco no personagem principal, explosoes no fundo, composicao cinematica e leitura clara."
              className="min-h-[108px] rounded-xl border-border/60 bg-card/60 p-3 focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{prompt.length}/{PROMPT_MAX}</p>
              <div className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5">
                <Globe className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] text-muted-foreground">Contexto web</span>
                <Switch checked={contextBoost} onCheckedChange={setContextBoost} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Tags</Label>
            <div className="rounded-lg border border-white/10 bg-card/20 p-2">
              <div className="flex max-h-[64px] flex-wrap gap-1.5 overflow-y-auto pr-1">
                {TAG_OPTIONS.map((tag) => {
                  const selected = selectedTags.includes(tag);
                  return (
                    <button
                      key={`tag-${tag}`}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] leading-4 transition ${
                        selected
                          ? "border-primary bg-primary text-black"
                          : "border-white/10 bg-transparent text-foreground hover:border-primary"
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Selecionadas: {tags.join(", ")}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
            <div className="space-y-2">
              <Label className="text-sm">Style mode (opcional)</Label>
              <div className="flex flex-wrap gap-2">
                {STYLE_MODE_OPTIONS.map((style) => {
                  const isSelected = styleMode === style.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setStyleMode(isSelected ? "" : style.id)}
                      className={`h-8 rounded-full border px-3 text-[11px] transition ${
                        isSelected
                          ? "border-primary bg-primary text-black"
                          : "border-white/10 bg-transparent text-foreground hover:border-primary"
                      }`}
                    >
                      {style.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Sem selecao = Auto</p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Mood</Label>
              <div className="flex flex-wrap gap-2">
                {MOOD_OPTIONS.map((mood) => {
                  const isSelected = moodOverride === mood.id;
                  return (
                    <button
                      key={mood.id}
                      type="button"
                      onClick={() => setMoodOverride(isSelected ? "" : mood.id)}
                      className={`h-8 rounded-full border px-3 text-sm transition ${
                        isSelected
                          ? "border-primary bg-primary text-black"
                          : "border-white/10 bg-transparent text-foreground hover:border-primary"
                      }`}
                    >
                      {mood.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Angulo de camera</Label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {CAMERA_OPTIONS.map((camera) => {
                const isSelected = cameraAngle === camera.id;
                return (
                  <button
                    key={camera.id}
                    type="button"
                    onClick={() => setCameraAngle(camera.id)}
                    title={camera.description}
                    aria-label={`${camera.label}: ${camera.description}`}
                    className={`h-9 rounded-[10px] border px-2 text-sm transition ${
                      isSelected
                        ? "border-primary bg-primary text-black"
                        : "border-white/10 bg-transparent text-foreground hover:border-primary"
                    }`}
                  >
                    {camera.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <Button type="submit" disabled={loading || uploadingRef} className="h-11 w-full gap-2 text-base font-bold uppercase tracking-wide">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading || uploadingRef ? "Gerando..." : "Gerar imagem"}
            </Button>
            <p className="text-center text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {loading
                ? `Gerando... ${loadingElapsedSec || 1}s`
                : "Tempo medio de geracao: ~60s"}
            </p>
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          ) : null}
        </section>

        <aside className="flex flex-col gap-4 md:col-span-4">
          <Card>
            <CardHeader className="px-4 pb-2 pt-4">
              <CardTitle className="text-base">Imagem de referencia</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4">
              <input
                id="reference-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onSelectReferenceFile}
                className="hidden"
              />
              <label
                htmlFor="reference-upload"
                className="flex aspect-[16/8.6] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/70 bg-card/30 text-muted-foreground transition hover:border-primary/60"
              >
                {referencePreviewUrl ? (
                  <img src={referencePreviewUrl} alt="reference-preview" className="h-full w-full rounded-xl object-cover" />
                ) : (
                  <>
                    <ImagePlus className="mb-2 h-8 w-8" />
                    <span className="text-xs">Upload or drag & drop</span>
                  </>
                )}
              </label>
              {referencePreviewUrl ? (
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setLightboxUrl(referencePreviewUrl)}>
                  Abrir preview
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="px-4 pb-2 pt-4">
              <CardTitle className="text-base">Skins (max {maxSkinRefs})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4">
              <Input
                value={skinQuery}
                onChange={(e) => setSkinQuery(e.target.value)}
                placeholder="Buscar skins (ex.: Peely, Midas...)"
              />

              <div className="h-10">
                <div className="flex h-full items-center gap-2 overflow-x-auto whitespace-nowrap pr-1">
                  {selectedSkins.map((skin) => (
                    <button
                      key={`selected-${skin.id}`}
                      type="button"
                      onClick={() => toggleSkin(skin)}
                      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-primary bg-primary/10 px-2 py-1 text-xs"
                    >
                      <img src={skin.image_url} alt={skin.name} className="h-5 w-5 rounded-full object-cover" loading="lazy" />
                      <span className="max-w-28 truncate">{skin.name}</span>
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-[214px] overflow-y-auto rounded-lg border border-white/10 bg-card/30 p-4 pt-5 scroll-pt-5">
                {searchingSkins ? <p className="p-2 text-xs text-muted-foreground">Buscando skins...</p> : null}

                {skinResults.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3 pt-1">
                    {skinResults.map((skin) => {
                      const isSelected = selectedSkins.some((x) => x.id === skin.id);
                      return (
                        <button
                          key={skin.id}
                          type="button"
                          onClick={() => toggleSkin(skin)}
                          className={`relative overflow-hidden rounded-md border transition ${
                            isSelected ? "border-primary ring-1 ring-primary" : "border-white/10 hover:border-primary/60"
                          }`}
                          title={skin.name}
                        >
                          <img src={skin.image_url} alt={skin.name} className="h-20 w-full object-cover object-top" loading="lazy" />
                          <div className="truncate border-t border-white/10 bg-black/35 px-1 py-1 text-[10px]">{skin.name}</div>
                          {isSelected ? (
                            <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-black">
                              <Check className="h-3 w-3" />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : !searchingSkins ? (
                  <p className="p-2 text-xs text-muted-foreground">Nenhuma skin encontrada.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </aside>
      </form>

      {resultUrl ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <button
              type="button"
              onClick={() => setLightboxUrl(resultUrl)}
              className="overflow-hidden rounded-lg border border-border/70 bg-card/30"
            >
              <img src={resultUrl} alt="tgis-result" className="aspect-video w-full object-cover" loading="lazy" />
            </button>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {result?.image?.width || 1920}x{result?.image?.height || 1080}
              </span>
              <Button size="sm" variant="ghost" onClick={() => downloadImage(resultUrl)}>
                <Download className="mr-1 h-3.5 w-3.5" />
                Baixar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-border/70 bg-card/95 p-6 text-center shadow-2xl">
            <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium">Gerando thumbnail...</p>
            <p className="mt-1 text-xs text-muted-foreground">Isso pode levar alguns segundos.</p>
            <p className="mt-3 text-xs uppercase tracking-[0.1em] text-muted-foreground">{loadingElapsedSec || 1}s</p>
          </div>
        </div>
      ) : null}

      {lightboxUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setLightboxUrl(null)}>
          <button
            type="button"
            className="absolute right-4 top-4 rounded border border-white/30 bg-black/40 p-2 text-white"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="preview"
            className="max-h-[90vh] max-w-[95vw] rounded-md border border-white/20 object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
