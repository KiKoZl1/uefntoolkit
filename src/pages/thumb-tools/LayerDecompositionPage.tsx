import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Layers3, Loader2, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useThumbTools } from "@/features/tgis-thumb-tools/ThumbToolsProvider";
import RecentAssetsPicker from "@/features/tgis-thumb-tools/RecentAssetsPicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

type LayerItem = {
  index: number;
  name: string;
  url: string;
  width: number;
  height: number;
  visible: boolean;
};

const FIXED_LAYER_COUNT = 4;

export default function LayerDecompositionPage() {
  const { toast } = useToast();
  const { history, currentAsset, setCurrentAsset, deleteAsset } = useThumbTools();
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [warningText, setWarningText] = useState("");
  const [layers, setLayers] = useState<LayerItem[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
    async function drawComposite() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const active = layers.filter((x) => x.visible);
      for (const layer of active) {
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.crossOrigin = "anonymous";
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error("layer_image_load_failed"));
            el.src = layer.url;
          });
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        } catch {
          // ignore per-layer preview failure
        }
      }
    }
    void drawComposite();
  }, [layers]);

  async function runLayerDecomposition() {
    setErrorText("");
    setWarningText("");
    setLayers([]);
    if (!sourceImageUrl) {
      setErrorText("Selecione um source image.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("tgis-layer-decompose", {
      body: {
        assetId: currentAsset?.id || undefined,
        sourceImageUrl,
        numLayers: FIXED_LAYER_COUNT,
      },
    });
    setLoading(false);

    if (error || data?.success === false) {
      setErrorText(String(error?.message || data?.error || "Falha no layer decomposition."));
      return;
    }

    const nextLayers = (Array.isArray(data?.layers) ? data.layers : []).map((l: any, idx: number) => ({
      index: Number(l?.index || idx + 1),
      name: String(l?.name || `Layer_${idx + 1}`),
      url: String(l?.url || ""),
      width: Number(l?.width || 1920),
      height: Number(l?.height || 1080),
      visible: true,
    })) as LayerItem[];
    setLayers(nextLayers);
    setWarningText(String(data?.warning || ""));
    toast({ title: "Layer decomposition concluida." });
  }

  function toggleLayerVisibility(index: number, visible: boolean) {
    setLayers((prev) => prev.map((layer) => (layer.index === index ? { ...layer, visible } : layer)));
  }

  async function downloadViaFallback(files: Array<{ url: string; name: string }>, zip = true) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const resp = await fetch(`${supabaseUrl}/functions/v1/tgis-layer-download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        files,
        zip,
        zipName: `thumb_${Date.now()}_layers.zip`,
      }),
    });
    if (!resp.ok) throw new Error(`download_failed_${resp.status}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = zip ? `thumb_${Date.now()}_layers.zip` : files[0].name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-6 py-6">
      <header className="space-y-1">
        <Button variant="ghost" asChild className="-ml-2 h-8 w-fit px-2 text-muted-foreground hover:text-foreground">
          <Link to="/app/thumb-tools">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Thumb Tools
          </Link>
        </Button>
        <h1 className="font-display text-3xl font-bold">Layer Decomposition</h1>
        <p className="text-sm text-muted-foreground">Separacao em camadas com preview e export.</p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="space-y-4 lg:col-span-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Configuracao</CardTitle></CardHeader>
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
                    if (currentAsset?.id === item.id) setSourceImageUrl("");
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

              <div className="space-y-1">
                <Label>Numero de camadas: {FIXED_LAYER_COUNT}</Label>
                <p className="text-xs text-muted-foreground">Valor fixo nesta versao para manter consistencia.</p>
              </div>

              <Button onClick={runLayerDecomposition} disabled={loading} className="w-full gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers3 className="h-4 w-4" />}
                Decompor camadas
              </Button>
              {errorText ? <p className="text-xs text-destructive">{errorText}</p> : null}
              {warningText ? <p className="text-xs text-amber-500">{warningText}</p> : null}
            </CardContent>
          </Card>

          {layers.length ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Camadas</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {layers.map((layer) => (
                  <div key={layer.index} className="flex items-center justify-between rounded border border-border/60 px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={layer.visible}
                        onCheckedChange={(value) => toggleLayerVisibility(layer.index, Boolean(value))}
                      />
                      <span className="text-sm">{layer.name}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1"
                      onClick={() => downloadViaFallback([{ url: layer.url, name: `${layer.name}.png` }], false)}
                    >
                      <Download className="h-3.5 w-3.5" /> PNG
                    </Button>
                  </div>
                ))}
                <Button
                  variant="default"
                  className="mt-2 w-full gap-2"
                  onClick={() => downloadViaFallback(layers.map((layer) => ({ url: layer.url, name: `${layer.name}.png` })), true)}
                >
                  <Download className="h-4 w-4" />
                  Download ZIP
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </section>

        <section className="space-y-4 lg:col-span-7">
          <Card>
            <CardHeader><CardTitle className="text-base">Composite Preview</CardTitle></CardHeader>
            <CardContent>
              <canvas
                ref={canvasRef}
                width={960}
                height={540}
                className="aspect-video w-full rounded border border-border/60 bg-black/40"
              />
            </CardContent>
          </Card>
        </section>
      </div>

      {loading ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-border/70 bg-card/95 p-6 text-center shadow-2xl">
            <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium">Separando camadas...</p>
            <p className="mt-1 text-xs text-muted-foreground">Isso pode levar alguns segundos.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
