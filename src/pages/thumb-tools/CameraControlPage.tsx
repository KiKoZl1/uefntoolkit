import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Camera, Loader2, Save, ArrowLeft, Download } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useThumbTools } from "@/features/tgis-thumb-tools/ThumbToolsProvider";
import RecentAssetsPicker from "@/features/tgis-thumb-tools/RecentAssetsPicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

type Preset = "heroic" | "confronto" | "epicidade" | "overview" | "cinematic" | "god_view" | "custom";
const CameraGizmo3D = lazy(() => import("@/features/tgis-thumb-tools/CameraGizmo3D"));
const CAMERA_CONTROL_PHASES = [
  "Analisando composicao e profundidade...",
  "Reprojetando enquadramento e angulo...",
  "Ajustando perspectiva e foco visual...",
  "Renderizando frame final...",
] as const;

const PRESETS: Array<{ id: Preset; label: string; values: { azimuth: number; elevation: number; distance: number } }> = [
  { id: "heroic", label: "Heroic", values: { azimuth: 22, elevation: -12, distance: 0.85 } },
  { id: "confronto", label: "Confronto", values: { azimuth: 0, elevation: -6, distance: 0.95 } },
  { id: "epicidade", label: "Epicidade", values: { azimuth: 30, elevation: -14, distance: 0.82 } },
  { id: "overview", label: "Overview", values: { azimuth: 0, elevation: 28, distance: 1.25 } },
  { id: "cinematic", label: "Cinematic", values: { azimuth: 18, elevation: -8, distance: 0.9 } },
  { id: "god_view", label: "God View", values: { azimuth: 0, elevation: 52, distance: 1.4 } },
];

export default function CameraControlPage() {
  const { toast } = useToast();
  const { history, currentAsset, setCurrentAsset, registerAsset, deleteAsset } = useThumbTools();
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [preset, setPreset] = useState<Preset>("custom");
  const [azimuth, setAzimuth] = useState(0);
  const [elevation, setElevation] = useState(0);
  const [distance, setDistance] = useState(1);
  const [loading, setLoading] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [pendingResultAssetId, setPendingResultAssetId] = useState("");
  const [loadingElapsedSec, setLoadingElapsedSec] = useState(0);

  const sourceCandidates = useMemo(() => history.slice(0, 20), [history]);
  const selectedSourceId = useMemo(() => {
    if (currentAsset?.id) return currentAsset.id;
    const byUrl = sourceCandidates.find((x) => x.image_url === sourceImageUrl);
    return byUrl?.id ?? null;
  }, [currentAsset?.id, sourceCandidates, sourceImageUrl]);

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

  function applyPreset(nextPreset: Preset) {
    setPreset(nextPreset);
    if (nextPreset === "custom") return;
    const p = PRESETS.find((x) => x.id === nextPreset);
    if (!p) return;
    setAzimuth(p.values.azimuth);
    setElevation(p.values.elevation);
    setDistance(p.values.distance);
  }

  async function runCameraControl() {
    setErrorText("");
    setResultUrl("");
    setPendingResultAssetId("");
    if (!sourceImageUrl) {
      setErrorText("Selecione um source image.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.functions.invoke("tgis-camera-control", {
      body: {
        assetId: currentAsset?.id || undefined,
        sourceImageUrl,
        preset,
        azimuth,
        elevation,
        distance,
      },
    });
    setLoading(false);

    if (error || data?.success === false) {
      setErrorText(String(error?.message || data?.error || "Falha no camera control."));
      return;
    }

    const imageUrl = String(data?.image?.url || "").trim();
    const newAssetId = String(data?.assetId || "").trim();
    setResultUrl(imageUrl);
    setPendingResultAssetId(newAssetId);
    toast({ title: "Camera control concluido", description: "Revise o resultado e clique em Salvar resultado." });
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
      a.download = `camera-control-${Date.now()}.png`;
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
    () => CAMERA_CONTROL_PHASES[Math.floor((Math.max(1, loadingElapsedSec) - 1) / 4) % CAMERA_CONTROL_PHASES.length],
    [loadingElapsedSec],
  );

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
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Camera Control</h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Ajuste enquadramento, inclinacao e distancia com presets ou controle fino em gizmo 3D interativo.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="space-y-4">
          <Card className="border-border/70 bg-card/30">
            <CardHeader><CardTitle className="text-base">Parametros</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Galeria</Label>
                <RecentAssetsPicker
                  items={sourceCandidates.map((asset) => ({
                    id: asset.id,
                    image_url: asset.image_url,
                    title: asset.id,
                    canDelete: true,
                  }))}
                  selectedId={selectedSourceId}
                  onSelect={(item) => {
                    const asset = sourceCandidates.find((x) => x.id === item.id);
                    if (!asset) return;
                    setCurrentAsset(asset);
                    setSourceImageUrl(asset.image_url);
                  }}
                  onDelete={async (item) => {
                    await deleteAsset(item.id);
                    if (currentAsset?.id === item.id) {
                      setSourceImageUrl("");
                    }
                    toast({ title: "Asset deletado." });
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Source image URL</Label>
                <Input
                  value={sourceImageUrl}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSourceImageUrl(next);
                    if (next !== currentAsset?.image_url) setCurrentAsset(null);
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Preset</Label>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <Button key={p.id} type="button" size="sm" variant={preset === p.id ? "default" : "outline"} onClick={() => applyPreset(p.id)}>
                      {p.label}
                    </Button>
                  ))}
                  <Button type="button" size="sm" variant={preset === "custom" ? "default" : "outline"} onClick={() => applyPreset("custom")}>
                    Custom
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Azimuth: {azimuth.toFixed(1)}</Label>
                <Slider value={[azimuth]} min={-70} max={70} step={1} onValueChange={(v) => { setPreset("custom"); setAzimuth(v[0] ?? 0); }} />
              </div>

              <div className="space-y-1">
                <Label>Elevation: {elevation.toFixed(1)}</Label>
                <Slider value={[elevation]} min={-30} max={60} step={1} onValueChange={(v) => { setPreset("custom"); setElevation(v[0] ?? 0); }} />
              </div>

              <div className="space-y-1">
                <Label>Distance: {distance.toFixed(2)}</Label>
                <Slider value={[distance]} min={0.5} max={1.5} step={0.01} onValueChange={(v) => { setPreset("custom"); setDistance(v[0] ?? 1); }} />
              </div>

              <Button onClick={runCameraControl} disabled={loading} className="h-11 w-full gap-2 text-base font-bold uppercase tracking-wide">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                Gerar ajuste de camera
              </Button>
              <p className="text-center text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {loading ? `Processando (${loadingElapsedSec || 1}s)` : "Ajuste estimado: ~20-40s"}
              </p>
              {errorText ? <p className="text-xs text-destructive">{errorText}</p> : null}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          {resultUrl ? (
            <Card className="border-border/70 bg-card/35">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Resultado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <img src={resultUrl} alt="after" className="aspect-video w-full rounded border border-primary/40 object-cover" />
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
            <CardHeader><CardTitle className="text-base">Preview</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Controle 3D interativo</p>
                <Suspense
                  fallback={(
                    <div className="flex h-[360px] items-center justify-center rounded-xl border border-border/60 bg-card/70 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading 3D preview...
                    </div>
                  )}
                >
                  <CameraGizmo3D
                    sourceImageUrl={sourceImageUrl}
                    azimuth={azimuth}
                    elevation={elevation}
                    distance={distance}
                    onAzimuthChange={(v) => {
                      setPreset("custom");
                      setAzimuth(v);
                    }}
                    onElevationChange={(v) => {
                      setPreset("custom");
                      setElevation(v);
                    }}
                    onDistanceChange={(v) => {
                      setPreset("custom");
                      setDistance(v);
                    }}
                    onInteractionStart={() => setPreset("custom")}
                  />
                </Suspense>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Antes</p>
                  {sourceImageUrl ? (
                    <img src={sourceImageUrl} alt="before" className="aspect-video w-full rounded border border-border/60 object-cover" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded border border-border/60 text-sm text-muted-foreground">Sem source</div>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Depois</p>
                  {resultUrl ? (
                    <img src={resultUrl} alt="after" className="aspect-video w-full rounded border border-primary/40 object-cover" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded border border-border/60 text-sm text-muted-foreground">Execute para gerar preview</div>
                  )}
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
            <p className="text-sm font-medium">Aplicando camera control...</p>
            <p className="mt-1 text-xs text-muted-foreground">{loadingPhase}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.1em] text-muted-foreground">{loadingElapsedSec || 1}s decorridos</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
