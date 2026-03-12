import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Eraser, ImagePlus, Loader2, Paintbrush, Save, Wand2, X, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useThumbTools } from "@/features/tgis-thumb-tools/ThumbToolsProvider";
import RecentAssetsPicker, { type RecentAssetItem } from "@/features/tgis-thumb-tools/RecentAssetsPicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { executeCommerceTool } from "@/lib/commerce/client";
import { useToolCosts } from "@/hooks/useToolCosts";
import { ToolCostBadge } from "@/components/commerce/ToolCostBadge";
import { InsufficientCreditsCallout, toInsufficientCreditsDetails } from "@/components/commerce/InsufficientCreditsCallout";

type EditMode = "mask_edit" | "character_replace";
type EffectiveMode = "mask_edit" | "character_replace" | "custom_character";

type SkinSearchItem = { id: string; name: string; rarity: string; image_url: string };
type LocalSourceUpload = { id: string; image_url: string; width: number; height: number; created_at: string };

const TAG_OPTIONS = [
  "Tycoon", "Horror", "Prop Hunt", "Deathrun", "Fashion", "1v1", "2v2", "3v3",
  "Board Game", "Boxfight", "Escape", "Free For All", "Gun Game", "Party Game",
  "Pvp", "Race", "Roguelike", "Role Playing", "Simulator", "Sniper", "Zonewars",
  "Bedwars", "Red Vs Blue",
] as const;

const TAGS_MAX = 24;
const SKIN_RESULT_LIMIT = 100;
const EDIT_STUDIO_PHASES = [
  "Analisando mascara e estrutura da cena...",
  "Aplicando substituicao e blend visual...",
  "Refinando luz, bordas e consistencia...",
  "Renderizando resultado final...",
] as const;

async function invokeSkinSearch(q: string, limit = SKIN_RESULT_LIMIT): Promise<SkinSearchItem[]> {
  const { data, error } = await supabase.functions.invoke("tgis-skins-search", { body: { q, limit, page: 1 } });
  if (error || data?.success === false) return [];
  return Array.isArray(data?.items) ? data.items : [];
}

async function uploadFileToUserReferences(file: File, prefix: string): Promise<string> {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user?.id) throw new Error("missing_user_session_for_upload");
  const uid = userRes.user.id;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `${uid}/${prefix}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabase.storage.from("tgis-user-references").upload(path, file, {
    upsert: false,
    contentType: file.type || "image/jpeg",
  });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from("tgis-user-references").getPublicUrl(path);
  return data.publicUrl;
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image_dimension_read_failed"));
      el.src = objectUrl;
    });
    return { width: Math.max(1, Math.round(img.naturalWidth || 1920)), height: Math.max(1, Math.round(img.naturalHeight || 1080)) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function EditStudioPage() {
  const { toast } = useToast();
  const { getCost } = useToolCosts();
  const { history, currentAsset, registerAsset, setCurrentAsset, deleteAsset } = useThumbTools();
  const [mode, setMode] = useState<EditMode>("mask_edit");
  const [prompt, setPrompt] = useState("");
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [contextBoost, setContextBoost] = useState(true);
  const [skinQuery, setSkinQuery] = useState("");
  const [skinResults, setSkinResults] = useState<SkinSearchItem[]>([]);
  const [searchingSkins, setSearchingSkins] = useState(false);
  const [selectedReplacementSkin, setSelectedReplacementSkin] = useState<SkinSearchItem | null>(null);
  const [customCharacterUrl, setCustomCharacterUrl] = useState("");
  const [customCharacterPreview, setCustomCharacterPreview] = useState("");
  const [customCharacterName, setCustomCharacterName] = useState("Custom character");
  const [uploadingSource, setUploadingSource] = useState(false);
  const [uploadingCustomCharacter, setUploadingCustomCharacter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [insufficientCredits, setInsufficientCredits] = useState<ReturnType<typeof toInsufficientCreditsDetails>>(null);
  const [resultUrl, setResultUrl] = useState("");
  const [pendingResultAssetId, setPendingResultAssetId] = useState("");
  const [loadingElapsedSec, setLoadingElapsedSec] = useState(0);
  const [localSourceUploads, setLocalSourceUploads] = useState<LocalSourceUpload[]>([]);
  const [brushSize, setBrushSize] = useState(22);
  const [maskOpacity, setMaskOpacity] = useState(0.45);
  const [eraser, setEraser] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceUploadInputRef = useRef<HTMLInputElement | null>(null);
  const customCharacterInputRef = useRef<HTMLInputElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const sourceCandidates = useMemo(() => history.slice(0, 12), [history]);
  const unifiedSourceItems = useMemo<RecentAssetItem[]>(() => {
    const actionItem: RecentAssetItem = {
      id: "action:upload-source",
      image_url: "",
      title: "Upload source",
      kind: "action",
      actionLabel: "Upload source",
      canDelete: false,
    };
    const localItems = localSourceUploads.map((item) => ({
      id: `local:${item.id}`,
      image_url: item.image_url,
      title: "Upload local",
      canDelete: true,
    }));
    const historyItems = sourceCandidates.map((item) => ({
      id: `asset:${item.id}`,
      image_url: item.image_url,
      title: item.id,
      canDelete: true,
    }));
    return [actionItem, ...localItems, ...historyItems];
  }, [localSourceUploads, sourceCandidates]);

  const selectedSourceItemId = useMemo(() => {
    if (currentAsset?.id) return `asset:${currentAsset.id}`;
    const local = localSourceUploads.find((x) => x.image_url === sourceImageUrl);
    return local ? `local:${local.id}` : null;
  }, [currentAsset?.id, localSourceUploads, sourceImageUrl]);
  const tags = useMemo(() => Array.from(new Set(selectedTags.map((x) => String(x || "").trim()).filter(Boolean))).slice(0, TAGS_MAX), [selectedTags]);
  const activeReplacement = useMemo(() => {
    if (selectedReplacementSkin) return { kind: "skin" as const, label: selectedReplacementSkin.name, image_url: selectedReplacementSkin.image_url };
    if (customCharacterUrl) return { kind: "custom" as const, label: customCharacterName, image_url: customCharacterPreview || customCharacterUrl };
    return null;
  }, [selectedReplacementSkin, customCharacterName, customCharacterPreview, customCharacterUrl]);

  useEffect(() => {
    if (currentAsset?.image_url) setSourceImageUrl(currentAsset.image_url);
  }, [currentAsset?.id, currentAsset?.image_url]);

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

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchingSkins(true);
      const items = await invokeSkinSearch(skinQuery.trim());
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
      if (customCharacterPreview.startsWith("blob:")) URL.revokeObjectURL(customCharacterPreview);
    };
  }, [customCharacterPreview]);

  function ensureCanvasSize() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const rect = img.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function clearMask() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawPoint(x: number, y: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.strokeStyle = "rgba(255,255,255,1)";
    const last = lastPointRef.current;
    if (!last) {
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    lastPointRef.current = { x, y };
  }

  function toLocalPoint(ev: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function toggleTag(tag: string) {
    const normalized = String(tag || "").trim();
    if (!normalized) return;
    setSelectedTags((prev) => (
      prev.includes(normalized)
        ? prev.filter((x) => x !== normalized)
        : [...prev, normalized].slice(0, TAGS_MAX)
    ));
  }

  function selectHistorySource(asset: (typeof sourceCandidates)[number]) {
    setCurrentAsset(asset);
    setSourceImageUrl(asset.image_url);
  }

  function selectLocalSource(item: LocalSourceUpload) {
    setCurrentAsset(null);
    setSourceImageUrl(item.image_url);
  }

  async function handleSourceUpload(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0] || null;
    if (!file) return;
    setErrorText("");
    setUploadingSource(true);
    try {
      const [publicUrl, dims, userRes] = await Promise.all([
        uploadFileToUserReferences(file, "edit-source"),
        readImageDimensions(file),
        supabase.auth.getUser(),
      ]);
      const userId = userRes.data.user?.id;
      if (!userId) throw new Error("missing_user_session_for_asset_create");
      const { data: row, error } = await (supabase as any)
        .from("tgis_thumb_assets")
        .insert({
          user_id: userId,
          parent_asset_id: null,
          source_generation_id: null,
          origin_tool: "edit_studio",
          image_url: publicUrl,
          width: dims.width,
          height: dims.height,
          metadata_json: { source_upload: true, file_name: file.name },
        })
        .select("id,user_id,source_generation_id,parent_asset_id,origin_tool,image_url,width,height,metadata_json,created_at")
        .limit(1)
        .maybeSingle();
      if (row?.id && !error) {
        registerAsset(row as any);
        setCurrentAsset(row as any);
        setSourceImageUrl(publicUrl);
        toast({ title: "Source enviado", description: "Imagem adicionada nos assets recentes." });
      } else {
        const localItem: LocalSourceUpload = {
          id: `local-${Date.now()}`,
          image_url: publicUrl,
          width: dims.width,
          height: dims.height,
          created_at: new Date().toISOString(),
        };
        setLocalSourceUploads((prev) => [localItem, ...prev].slice(0, 8));
        setCurrentAsset(null);
        setSourceImageUrl(publicUrl);
        toast({ title: "Source enviado", description: "Imagem carregada para uso imediato." });
      }
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingSource(false);
      if (sourceUploadInputRef.current) sourceUploadInputRef.current.value = "";
    }
  }

  async function handleCustomCharacterUpload(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0] || null;
    if (!file) return;
    setErrorText("");
    setUploadingCustomCharacter(true);
    try {
      const publicUrl = await uploadFileToUserReferences(file, "edit-custom-character");
      if (customCharacterPreview.startsWith("blob:")) URL.revokeObjectURL(customCharacterPreview);
      const blobPreview = URL.createObjectURL(file);
      setCustomCharacterUrl(publicUrl);
      setCustomCharacterPreview(blobPreview);
      setCustomCharacterName(file.name || "Custom character");
      setSelectedReplacementSkin(null);
      toast({ title: "Custom character carregado" });
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingCustomCharacter(false);
      if (customCharacterInputRef.current) customCharacterInputRef.current.value = "";
    }
  }

  function chooseSkin(item: SkinSearchItem) {
    setSelectedReplacementSkin(item);
    if (customCharacterPreview.startsWith("blob:")) URL.revokeObjectURL(customCharacterPreview);
    setCustomCharacterPreview("");
    setCustomCharacterUrl("");
    setCustomCharacterName("Custom character");
  }

  async function submit() {
    setErrorText("");
    setInsufficientCredits(null);
    setResultUrl("");
    setPendingResultAssetId("");
    if (!sourceImageUrl) {
      setErrorText("Selecione um source image em assets recentes ou via upload.");
      return;
    }
    if ((mode === "mask_edit" || mode === "character_replace") && !canvasRef.current) {
      setErrorText("Mascara nao disponivel.");
      return;
    }
    const effectiveMode: EffectiveMode = mode === "mask_edit"
      ? "mask_edit"
      : selectedReplacementSkin
        ? "character_replace"
        : customCharacterUrl
          ? "custom_character"
          : "character_replace";
    if (mode === "character_replace" && !selectedReplacementSkin && !customCharacterUrl) {
      setErrorText("Selecione uma skin de replacement ou envie um custom character.");
      return;
    }
    const promptValue = prompt.trim();
    const replacementSkinIdValue = selectedReplacementSkin?.id || "";
    const customCharacterImageUrlValue = customCharacterUrl;
    const maskDataUrl = (mode === "mask_edit" || mode === "character_replace")
      ? canvasRef.current?.toDataURL("image/png")
      : undefined;
    setLoading(true);
    let data: any = null;
    let error: Error | null = null;
    try {
      const commerce = await executeCommerceTool({
        toolCode: "edit_studio",
        payload: {
          assetId: currentAsset?.id || undefined,
          sourceImageUrl,
          mode: effectiveMode,
          prompt: promptValue || undefined,
          maskDataUrl,
          replacementSkinId: effectiveMode === "character_replace" ? replacementSkinIdValue : undefined,
          customCharacterImageUrl: effectiveMode === "custom_character" ? customCharacterImageUrlValue : undefined,
          tags,
          contextBoost,
        },
      });
      data = commerce?.tool_result || null;
    } catch (e) {
      error = e as Error;
      data = (e as any)?.payload || null;
    }
    setLoading(false);
    if (error || data?.success === false) {
      const insufficient = toInsufficientCreditsDetails(data);
      if (insufficient) {
        setInsufficientCredits(insufficient);
      } else {
        setErrorText(String(error?.message || data?.error || "Falha no edit studio."));
      }
      return;
    }
    const imageUrl = String(data?.image?.url || "").trim();
    const newAssetId = String(data?.assetId || "").trim();
    setResultUrl(imageUrl);
    setPendingResultAssetId(newAssetId);
    toast({ title: "Edicao concluida", description: "Revise o resultado e clique em Salvar resultado." });
  }

  async function saveResult() {
    if (!pendingResultAssetId) return;
    setSavingResult(true);
    const { data: row } = await (supabase as any)
      .from("tgis_thumb_assets")
      .select("id,user_id,source_generation_id,parent_asset_id,origin_tool,image_url,width,height,metadata_json,created_at")
      .eq("id", pendingResultAssetId)
      .limit(1)
      .maybeSingle();
    setSavingResult(false);
    if (!row?.id) {
      setErrorText("Nao foi possivel salvar resultado no estado local.");
      return;
    }
    registerAsset(row as any);
    setCurrentAsset(row as any);
    setPendingResultAssetId("");
    toast({ title: "Resultado salvo", description: "Imagem definida como base atual para o proximo passo." });
  }

  async function downloadResultImage(url: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("download_failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `edit-studio-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      return;
    } catch {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  const loadingPhase = useMemo(
    () => EDIT_STUDIO_PHASES[Math.floor((Math.max(1, loadingElapsedSec) - 1) / 4) % EDIT_STUDIO_PHASES.length],
    [loadingElapsedSec],
  );
  const creditCost = getCost("edit_studio");

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <header className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card/85 via-card/60 to-background p-5 md:p-7">
        <div className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative space-y-3">
          <Button variant="ghost" asChild className="-ml-2 h-8 w-fit px-2 text-muted-foreground hover:text-foreground">
            <Link to="/app/thumb-tools">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Thumb Tools
            </Link>
          </Button>
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Edit Studio</h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Mask edit e character replace com controle de mascara, referencia de skin e refinamento de estilo.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="space-y-4 xl:col-span-3">
          <Card className="border-border/70 bg-card/30">
            <CardHeader><CardTitle className="text-base">Configuracao</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {([
                  { id: "mask_edit", label: "Edit" },
                  { id: "character_replace", label: "Replace Character" },
                ] as Array<{ id: EditMode; label: string }>).map((item) => (
                  <Button key={item.id} type="button" variant={mode === item.id ? "default" : "outline"} className="h-8" onClick={() => setMode(item.id)}>
                    {item.label}
                  </Button>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Galeria</Label>
                  <input ref={sourceUploadInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSourceUpload} className="hidden" />
                </div>

                <RecentAssetsPicker
                  items={unifiedSourceItems}
                  selectedId={selectedSourceItemId}
                  onSelect={(item) => {
                    if (item.id === "action:upload-source") {
                      sourceUploadInputRef.current?.click();
                      return;
                    }
                    if (item.id.startsWith("local:")) {
                      const localId = item.id.replace("local:", "");
                      const local = localSourceUploads.find((x) => x.id === localId);
                      if (local) selectLocalSource(local);
                      return;
                    }
                    const assetId = item.id.replace("asset:", "");
                    const asset = sourceCandidates.find((x) => x.id === assetId);
                    if (asset) selectHistorySource(asset);
                  }}
                  onDelete={async (item) => {
                    if (item.id === "action:upload-source") return;
                    if (item.id.startsWith("local:")) {
                      const localId = item.id.replace("local:", "");
                      const local = localSourceUploads.find((x) => x.id === localId);
                      setLocalSourceUploads((prev) => prev.filter((x) => x.id !== localId));
                      if (local?.image_url && sourceImageUrl === local.image_url) {
                        setSourceImageUrl("");
                      }
                      toast({ title: "Asset local removido." });
                      return;
                    }
                    const assetId = item.id.replace("asset:", "");
                    await deleteAsset(assetId);
                    if (currentAsset?.id === assetId) setSourceImageUrl("");
                    toast({ title: "Asset deletado." });
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Prompt (opcional)</Label>
                <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-[96px]" />
              </div>

              <div className="space-y-2">
                <Label>Tags</Label>
                <div className="rounded-lg border border-white/10 bg-card/20 p-2">
                  <div className="flex max-h-[72px] flex-wrap gap-1.5 overflow-y-auto pr-1">
                    {TAG_OPTIONS.map((tag) => {
                      const selected = selectedTags.includes(tag);
                      return (
                        <button
                          key={`edit-tag-${tag}`}
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
                <p className="text-xs text-muted-foreground">Selecionadas: {tags.length ? tags.join(", ") : "nenhuma"}</p>
              </div>

              {mode === "character_replace" ? (
                <div className="space-y-2">
                  <Label>Replacement Skin</Label>
                  <Input value={skinQuery} onChange={(e) => setSkinQuery(e.target.value)} placeholder="Buscar skins (ex.: Peely, Midas...)" />

                  <div className="h-9">
                    {activeReplacement ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full border border-primary bg-primary/10 px-2 py-1 text-xs"
                        onClick={() => {
                          setSelectedReplacementSkin(null);
                          if (customCharacterPreview.startsWith("blob:")) URL.revokeObjectURL(customCharacterPreview);
                          setCustomCharacterPreview("");
                          setCustomCharacterUrl("");
                          setCustomCharacterName("Custom character");
                        }}
                      >
                        <img src={activeReplacement.image_url} alt={activeReplacement.label} className="h-5 w-5 rounded-full object-cover" />
                        <span className="max-w-36 truncate">{activeReplacement.label}</span>
                        <X className="h-3 w-3" />
                      </button>
                    ) : (
                      <p className="text-xs text-muted-foreground">Selecione 1 replacement.</p>
                    )}
                  </div>

                  <input ref={customCharacterInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleCustomCharacterUpload} className="hidden" />
                  <div className="h-[220px] overflow-y-auto rounded-lg border border-white/10 bg-card/30 p-3">
                    {searchingSkins ? <p className="p-2 text-xs text-muted-foreground">Buscando skins...</p> : null}
                    <div className="grid grid-cols-3 gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => customCharacterInputRef.current?.click()}
                        className={`relative flex h-[106px] flex-col items-center justify-center rounded-md border transition ${
                          activeReplacement?.kind === "custom"
                            ? "border-primary ring-1 ring-primary"
                            : "border-white/10 hover:border-primary/60"
                        }`}
                        title="Upload custom character"
                      >
                        {uploadingCustomCharacter ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : activeReplacement?.kind === "custom" ? (
                          <img src={activeReplacement.image_url} alt="custom-character" className="h-20 w-full object-cover object-top" />
                        ) : (
                          <ImagePlus className="h-6 w-6" />
                        )}
                        <div className="mt-1 text-[10px] text-muted-foreground">Custom</div>
                        {activeReplacement?.kind === "custom" ? (
                          <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-black"><Check className="h-3 w-3" /></span>
                        ) : null}
                      </button>

                      {skinResults.map((skin) => {
                        const isSelected = activeReplacement?.kind === "skin" && selectedReplacementSkin?.id === skin.id;
                        return (
                          <button
                            key={skin.id}
                            type="button"
                            onClick={() => chooseSkin(skin)}
                            className={`relative overflow-hidden rounded-md border transition ${
                              isSelected ? "border-primary ring-1 ring-primary" : "border-white/10 hover:border-primary/60"
                            }`}
                            title={skin.name}
                          >
                            <img src={skin.image_url} alt={skin.name} className="h-20 w-full object-cover object-top" loading="lazy" />
                            <div className="truncate border-t border-white/10 bg-black/35 px-1 py-1 text-[10px]">{skin.name}</div>
                            {isSelected ? (
                              <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-black"><Check className="h-3 w-3" /></span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    {!searchingSkins && skinResults.length === 0 ? (
                      <p className="p-2 text-xs text-muted-foreground">Nenhuma skin encontrada.</p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/30 px-3 py-2">
                <span className="text-sm">Contexto web</span>
                <Switch checked={contextBoost} onCheckedChange={setContextBoost} />
              </div>

              <Button
                onClick={submit}
                disabled={loading || uploadingSource || uploadingCustomCharacter}
                className="h-11 w-full gap-2 text-base font-bold uppercase tracking-wide"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Executar Edit Studio
              </Button>
              <div className="flex justify-center">
                <ToolCostBadge cost={creditCost} />
              </div>
              {insufficientCredits ? <InsufficientCreditsCallout details={insufficientCredits} onDismiss={() => setInsufficientCredits(null)} /> : null}
              {errorText ? <p className="text-xs text-destructive">{errorText}</p> : null}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4 xl:col-span-9">
          {resultUrl ? (
            <Card className="border-border/70 bg-card/35">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Resultado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <img src={resultUrl} alt="result" className="aspect-video w-full rounded border border-border/70 object-cover" />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => downloadResultImage(resultUrl)}>
                    <Download className="h-3.5 w-3.5" />
                    Baixar
                  </Button>
                  {pendingResultAssetId ? (
                    <Button type="button" size="sm" variant="secondary" className="h-8 gap-1.5" onClick={saveResult} disabled={savingResult}>
                      {savingResult ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Salvar resultado
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-border/70">
            <CardHeader><CardTitle className="text-base">Mask Canvas</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
                <div className="relative overflow-hidden rounded border border-border/60 bg-black/30">
                  {sourceImageUrl ? (
                    <>
                      <img
                        ref={imgRef}
                        src={sourceImageUrl}
                        alt="source"
                        className="block h-[min(72vh,760px)] w-full object-contain"
                        onLoad={() => {
                          ensureCanvasSize();
                          clearMask();
                        }}
                      />
                      <canvas
                        ref={canvasRef}
                        className="absolute inset-0 h-full w-full touch-none"
                        style={{ opacity: maskOpacity }}
                        onPointerDown={(ev) => {
                          ensureCanvasSize();
                          isDrawingRef.current = true;
                          lastPointRef.current = null;
                          const p = toLocalPoint(ev);
                          drawPoint(p.x, p.y);
                        }}
                        onPointerMove={(ev) => {
                          if (!isDrawingRef.current) return;
                          const p = toLocalPoint(ev);
                          drawPoint(p.x, p.y);
                        }}
                        onPointerUp={() => {
                          isDrawingRef.current = false;
                          lastPointRef.current = null;
                        }}
                        onPointerLeave={() => {
                          isDrawingRef.current = false;
                          lastPointRef.current = null;
                        }}
                      />
                    </>
                  ) : (
                    <div className="flex h-[min(72vh,760px)] items-center justify-center text-sm text-muted-foreground">Selecione um source image.</div>
                  )}
                </div>

                <div className="h-fit space-y-3 rounded border border-border/60 bg-card/30 p-3 xl:sticky xl:top-24">
                  <div className="space-y-1">
                    <Label className="text-xs">Brush size: {brushSize}</Label>
                    <Slider value={[brushSize]} min={4} max={120} step={1} onValueChange={(v) => setBrushSize(v[0] ?? 22)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mask opacity: {Math.round(maskOpacity * 100)}%</Label>
                    <Slider value={[maskOpacity]} min={0.1} max={1} step={0.05} onValueChange={(v) => setMaskOpacity(v[0] ?? 0.45)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant={eraser ? "outline" : "default"} onClick={() => setEraser(false)} className="h-8 gap-1">
                      <Paintbrush className="h-3.5 w-3.5" /> Brush
                    </Button>
                    <Button type="button" variant={eraser ? "default" : "outline"} onClick={() => setEraser(true)} className="h-8 gap-1">
                      <Eraser className="h-3.5 w-3.5" /> Erase
                    </Button>
                  </div>
                  <Button type="button" variant="outline" onClick={clearMask} className="h-8 w-full">Clear Mask</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      {loading ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-border/70 bg-card/95 p-6 text-center shadow-2xl">
            <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium">Aplicando edicao...</p>
            <p className="mt-1 text-xs text-muted-foreground">{loadingPhase}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.1em] text-muted-foreground">{loadingElapsedSec || 1}s decorridos</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
