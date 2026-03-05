import { useEffect, useMemo, useState } from "react";
import { Camera, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useThumbTools } from "@/features/tgis-thumb-tools/ThumbToolsProvider";
import CameraGizmo3D from "@/features/tgis-thumb-tools/CameraGizmo3D";
import RecentAssetsPicker from "@/features/tgis-thumb-tools/RecentAssetsPicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

type Preset = "heroic" | "confronto" | "epicidade" | "overview" | "cinematic" | "god_view" | "custom";

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

  const sourceCandidates = useMemo(() => history.slice(0, 20), [history]);
  const selectedSourceId = useMemo(() => {
    if (currentAsset?.id) return currentAsset.id;
    const byUrl = sourceCandidates.find((x) => x.image_url === sourceImageUrl);
    return byUrl?.id ?? null;
  }, [currentAsset?.id, sourceCandidates, sourceImageUrl]);

  useEffect(() => {
    if (currentAsset?.image_url) setSourceImageUrl(currentAsset.image_url);
  }, [currentAsset?.id, currentAsset?.image_url]);

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

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 px-6 py-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-bold">Camera Control</h1>
        <p className="text-sm text-muted-foreground">Controle de perspectiva com presets e ajustes finos.</p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="space-y-4 lg:col-span-5">
          <Card>
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

              <Button onClick={runCameraControl} disabled={loading} className="w-full gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                Gerar ajuste de camera
              </Button>
              {resultUrl && pendingResultAssetId ? (
                <Button onClick={saveResult} disabled={savingResult} variant="secondary" className="w-full gap-2">
                  {savingResult ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar resultado
                </Button>
              ) : null}
              {errorText ? <p className="text-xs text-destructive">{errorText}</p> : null}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4 lg:col-span-7">
          <Card>
            <CardHeader><CardTitle className="text-base">Preview</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Controle 3D interativo</p>
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
            <p className="mt-1 text-xs text-muted-foreground">Isso pode levar alguns segundos.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
