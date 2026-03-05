import { useEffect, useMemo, useState } from "react";
import { Copy, Download, History, Layers3, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { deleteWidgetKitHistory, listWidgetKitHistory, saveWidgetKitHistory } from "@/lib/widgetkit/history";
import { parsePsdFile, summarizePsdJson } from "@/lib/widgetkit/psd-parser";
import { generateBeginObject } from "@/lib/widgetkit/umg-generator";
import type { PsdJson, PsdParseSummary, UmgOutput, WidgetKitHistoryItem } from "@/types/widgetkit";

type PsdToolStatus =
  | "idle"
  | "parsing"
  | "preview"
  | "ready"
  | "error_format"
  | "error_empty"
  | "error_dimensions"
  | "error_too_many_layers";

function statusMessage(status: PsdToolStatus, t: (key: string) => string): string {
  if (status === "error_empty") return t("widgetKit.psdUmg.errorEmpty");
  if (status === "error_dimensions") return t("widgetKit.psdUmg.errorDimensions");
  if (status === "error_too_many_layers") return t("widgetKit.psdUmg.errorTooManyLayers");
  return t("widgetKit.psdUmg.errorFormat");
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function toPsdJson(value: unknown): PsdJson | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as PsdJson;
  if (!Array.isArray(candidate.layers)) return null;
  if (typeof candidate.width !== "number" || typeof candidate.height !== "number") return null;
  return candidate;
}

function metaCount(item: WidgetKitHistoryItem, key: string, fallback: number): number {
  const raw = item.meta_json?.[key];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function PsdToUmgTool({ active }: { active: boolean }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const [status, setStatus] = useState<PsdToolStatus>("idle");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadedOnce, setHistoryLoadedOnce] = useState(false);
  const [history, setHistory] = useState<WidgetKitHistoryItem[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const [parsedJson, setParsedJson] = useState<PsdJson | null>(null);
  const [summary, setSummary] = useState<PsdParseSummary | null>(null);
  const [umgOutput, setUmgOutput] = useState<UmgOutput | null>(null);
  const [includeTint, setIncludeTint] = useState(false);

  useEffect(() => {
    if (!active || historyLoadedOnce) return;

    let cancelled = false;
    setHistoryLoading(true);

    void listWidgetKitHistory("psd-umg")
      .then((rows) => {
        if (!cancelled) {
          setHistory(rows);
          setHistoryLoadedOnce(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast({ title: t("common.error"), description: t("widgetKit.historyLoadError"), variant: "destructive" });
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, historyLoadedOnce, t, toast]);

  const layerBreakdown = useMemo(() => {
    if (!summary) return null;
    return {
      total: summary.totalLayers,
      groups: summary.groupCount,
      images: summary.imageCount,
      texts: summary.textCount,
    };
  }, [summary]);

  async function processFile(file: File) {
    setStatus("parsing");
    setUmgOutput(null);

    try {
      const result = await parsePsdFile(file);
      setParsedJson(result.json);
      setSummary(result.summary);
      setStatus("preview");
    } catch (error) {
      const code = error instanceof Error ? (error.message as PsdToolStatus) : "error_format";
      setParsedJson(null);
      setSummary(null);
      setStatus(code || "error_format");
    }
  }

  async function handleGenerate(saveHistory: boolean) {
    if (!parsedJson || !summary) return;

    const output = generateBeginObject(parsedJson, { includeTint });
    setUmgOutput(output);
    setStatus("ready");

    if (!saveHistory) return;

    try {
      const saved = await saveWidgetKitHistory({
        tool: "psd-umg",
        name: parsedJson.file,
        data: parsedJson,
        meta: {
          totalLayers: summary.totalLayers,
          groupCount: summary.groupCount,
          imageCount: summary.imageCount,
          textCount: summary.textCount,
          includeTint,
        },
      });
      setHistory((prev) => [saved, ...prev].slice(0, 10));
    } catch {
      toast({ title: t("common.error"), description: t("widgetKit.historySaveError"), variant: "destructive" });
    }
  }

  async function handleCopy() {
    if (!umgOutput) return;
    try {
      await navigator.clipboard.writeText(umgOutput.beginObjectText);
      toast({ title: t("widgetKit.psdUmg.copySuccess") });
    } catch {
      toast({ title: t("common.error"), description: t("widgetKit.copyError"), variant: "destructive" });
    }
  }

  function resetState() {
    setStatus("idle");
    setParsedJson(null);
    setSummary(null);
    setUmgOutput(null);
    setIncludeTint(false);
  }

  async function handleHistoryOpen(item: WidgetKitHistoryItem) {
    const payload = toPsdJson(item.data_json);
    if (!payload) {
      toast({ title: t("common.error"), description: t("widgetKit.invalidHistory"), variant: "destructive" });
      return;
    }

    setParsedJson(payload);
    const nextSummary = summarizePsdJson(payload);
    setSummary(nextSummary);
    const metaTint = Boolean(item.meta_json?.includeTint);
    setIncludeTint(metaTint);

    const output = generateBeginObject(payload, { includeTint: metaTint });
    setUmgOutput(output);
    setStatus("ready");
  }

  async function handleDeleteHistory(id: string) {
    try {
      await deleteWidgetKitHistory(id);
      setHistory((prev) => prev.filter((item) => item.id !== id));
    } catch {
      toast({ title: t("common.error"), description: t("widgetKit.historyDeleteError"), variant: "destructive" });
    }
  }

  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";
  const isBusy = status === "parsing";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="space-y-4">
        <Card className="border-border/70 bg-gradient-to-br from-card to-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" />
              Upload PSD
            </CardTitle>
            <CardDescription>{t("widgetKit.psdUmg.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label
              className={`flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
                dragActive ? "border-primary bg-primary/10" : "border-border bg-background/40"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                const file = event.dataTransfer.files?.[0];
                if (file) void processFile(file);
              }}
            >
              <input
                type="file"
                accept=".psd"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void processFile(file);
                }}
              />
              <Upload className="mb-3 h-7 w-7 text-muted-foreground" />
              <p className="font-medium">{t("widgetKit.psdUmg.dropZoneLabel")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("widgetKit.psdUmg.dropZoneHint")}</p>
            </label>

            {isBusy ? (
              <div className="rounded-lg border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t("widgetKit.psdUmg.parsing")}</span>
                </div>
              </div>
            ) : null}

            {status.startsWith("error_") ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {statusMessage(status, t as (key: string) => string)}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={resetState}>
                {t("widgetKit.psdUmg.btnNewUpload")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers3 className="h-4 w-4" />
              Estrutura de Layers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {layerBreakdown ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{parsedJson?.file}</Badge>
                  <Badge variant="secondary">
                    {parsedJson?.width}x{parsedJson?.height}px
                  </Badge>
                  <Badge>{t("widgetKit.psdUmg.layersFound", { count: layerBreakdown.total })}</Badge>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">
                    {t("widgetKit.psdUmg.layerGroups.group")}: {layerBreakdown.groups}
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">
                    {t("widgetKit.psdUmg.layerGroups.image")}: {layerBreakdown.images}
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">
                    {t("widgetKit.psdUmg.layerGroups.text")}: {layerBreakdown.texts}
                  </div>
                </div>

                {summary?.warnings.includes("warning_many_layers") ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                    {t("widgetKit.psdUmg.warningManyLayers")}
                  </div>
                ) : null}

                <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/40 p-3">
                  <Checkbox
                    id="psd-include-tint"
                    checked={includeTint}
                    onCheckedChange={(checked) => setIncludeTint(Boolean(checked))}
                  />
                  <Label htmlFor="psd-include-tint" className="text-sm">
                    {t("widgetKit.psdUmg.optionTint")}
                  </Label>
                </div>

                <Button onClick={() => void handleGenerate(true)}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t("widgetKit.psdUmg.btnGenerate")}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Faça upload de um .psd para mostrar a estrutura.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Begin Object Output</CardTitle>
            <CardDescription>{t("widgetKit.psdUmg.pasteInstruction")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {umgOutput ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void handleCopy()}>
                    <Copy className="mr-2 h-4 w-4" />
                    {t("widgetKit.psdUmg.btnCopy")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadTextFile(
                        umgOutput.beginObjectText,
                        `${(parsedJson?.file || "widget").replace(/\.psd$/i, "")}_begin_object.txt`,
                      )
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {t("widgetKit.psdUmg.btnDownload")}
                  </Button>
                </div>
                <pre className="max-h-[460px] overflow-auto rounded-xl border border-border/70 bg-black/90 p-4 text-xs text-zinc-100">
                  <code>{umgOutput.beginObjectText}</code>
                </pre>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Gere o Begin Object para exibir o código aqui.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <aside>
        <Card className="sticky top-4 border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              {t("widgetKit.psdUmg.historyTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {historyLoading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : null}
            {!historyLoading && history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("widgetKit.psdUmg.historyEmpty")}</p>
            ) : null}

            {history.map((item) => (
              <div key={item.id} className="rounded-lg border border-border/70 bg-card/40 p-3">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString(locale)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("widgetKit.psdUmg.layersFound", { count: metaCount(item, "totalLayers", 0) })}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void handleHistoryOpen(item)}>
                    {t("common.view")}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => void handleDeleteHistory(item.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

