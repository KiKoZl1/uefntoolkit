import { useEffect, useMemo, useState } from "react";
import { Copy, Download, FileCode2, History, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteWidgetKitHistory, listWidgetKitHistory, saveWidgetKitHistory } from "@/lib/widgetkit/history";
import { parseUassetFile } from "@/lib/widgetkit/uasset-parser";
import { generateVerseOutput } from "@/lib/widgetkit/verse-generator";
import type { GeneratedOutput, ParsedWidget, WidgetKitHistoryItem } from "@/types/widgetkit";
import { executeCommerceTool, reverseCommerceOperation } from "@/lib/commerce/client";
import { useToolCosts } from "@/hooks/useToolCosts";
import { ToolCostBadge } from "@/components/commerce/ToolCostBadge";
import { InsufficientCreditsCallout, toInsufficientCreditsDetails } from "@/components/commerce/InsufficientCreditsCallout";

type UmgToolStatus = "empty" | "parsing" | "preview" | "ready" | "no_fields" | "error_format";

function statusMessage(_: UmgToolStatus, t: (key: string) => string): string {
  return t("widgetKit.umgVerse.errorFormat");
}

function toParsedWidget(value: unknown): ParsedWidget | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as ParsedWidget;
  if (!Array.isArray(candidate.fields)) return null;
  if (!candidate.fieldsByType || typeof candidate.fieldsByType !== "object") return null;

  return {
    ...candidate,
    sourceHasVerseClassFields: Boolean(candidate.sourceHasVerseClassFields),
  };
}

function metaCount(item: WidgetKitHistoryItem, key: string, fallback: number): number {
  const raw = item.meta_json?.[key];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
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

export default function UmgToVerseTool({ active }: { active: boolean }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { getCost } = useToolCosts();

  const [status, setStatus] = useState<UmgToolStatus>("empty");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadedOnce, setHistoryLoadedOnce] = useState(false);
  const [history, setHistory] = useState<WidgetKitHistoryItem[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const [parsedWidget, setParsedWidget] = useState<ParsedWidget | null>(null);
  const [generated, setGenerated] = useState<GeneratedOutput | null>(null);
  const [insufficientCredits, setInsufficientCredits] = useState<ReturnType<typeof toInsufficientCreditsDetails>>(null);

  useEffect(() => {
    if (!active || historyLoadedOnce) return;

    let cancelled = false;
    setHistoryLoading(true);

    void listWidgetKitHistory("umg-verse")
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

  const breakdown = useMemo(() => {
    if (!parsedWidget) return null;
    return {
      total: parsedWidget.fields.length,
      messages: parsedWidget.fieldsByType.messages.length,
      booleans: parsedWidget.fieldsByType.booleans.length,
      floats: parsedWidget.fieldsByType.floats.length,
      integers: parsedWidget.fieldsByType.integers.length,
      assets: parsedWidget.fieldsByType.assets.length,
      events: parsedWidget.fieldsByType.events.length,
    };
  }, [parsedWidget]);

  async function processFile(file: File) {
    setStatus("parsing");
    setGenerated(null);

    try {
      const parsed = await parseUassetFile(file);
      setParsedWidget(parsed);

      if (!parsed.sourceHasVerseClassFields || parsed.fields.length === 0) {
        setStatus("no_fields");
        return;
      }

      setStatus("preview");
    } catch (error) {
      const code = error instanceof Error ? (error.message as UmgToolStatus) : "error_format";
      setParsedWidget(null);
      setStatus(code || "error_format");
    }
  }

  async function handleGenerate(saveHistory: boolean) {
    if (!parsedWidget || parsedWidget.fields.length === 0) return;
    let operationId = "";
    setInsufficientCredits(null);
    try {
      const billing = await executeCommerceTool({
        toolCode: "umg_to_verse",
        payload: {
          widget_name: parsedWidget.widgetName,
          fields_total: parsedWidget.fields.length,
        },
      });
      operationId = String(billing?.operation_id || "");

      const output = generateVerseOutput(parsedWidget);
      setGenerated(output);
      setStatus("ready");

      if (!saveHistory) return;

      try {
        const saved = await saveWidgetKitHistory({
          tool: "umg-verse",
          name: `${parsedWidget.widgetName}.uasset`,
          data: parsedWidget,
          meta: {
            totalFields: parsedWidget.fields.length,
            messages: parsedWidget.fieldsByType.messages.length,
            booleans: parsedWidget.fieldsByType.booleans.length,
            floats: parsedWidget.fieldsByType.floats.length,
            integers: parsedWidget.fieldsByType.integers.length,
            assets: parsedWidget.fieldsByType.assets.length,
            events: parsedWidget.fieldsByType.events.length,
          },
        });
        setHistory((prev) => [saved, ...prev].slice(0, 10));
      } catch {
        toast({ title: t("common.error"), description: t("widgetKit.historySaveError"), variant: "destructive" });
      }
    } catch (error) {
      const code = String((error as any)?.payload?.error_code || "");
      if (operationId) {
        try {
          await reverseCommerceOperation({
            operationId,
            reason: "client_local_tool_failed_umg_to_verse",
          });
        } catch {
          // best effort
        }
      }
      const insufficient = toInsufficientCreditsDetails((error as any)?.payload || null);
      if (insufficient) {
        setInsufficientCredits(insufficient);
        return;
      }
      toast({
        title: t("common.error"),
        description: code === "INSUFFICIENT_CREDITS"
          ? "Saldo insuficiente. Compre creditos extras para continuar."
          : String((error as Error)?.message || "Falha ao consumir creditos."),
        variant: "destructive",
      });
    }
  }

  async function handleCopyAll() {
    if (!generated) return;

    const all = [`// ${generated.managerFileName}`, generated.managerCode, "", "// ui_core.verse", generated.uiCoreCode].join("\n");

    try {
      await navigator.clipboard.writeText(all);
      toast({ title: t("widgetKit.umgVerse.copySuccess") });
    } catch {
      toast({ title: t("common.error"), description: t("widgetKit.copyError"), variant: "destructive" });
    }
  }

  function resetState() {
    setStatus("empty");
    setParsedWidget(null);
    setGenerated(null);
  }

  async function handleHistoryOpen(item: WidgetKitHistoryItem) {
    const payload = toParsedWidget(item.data_json);
    if (!payload) {
      toast({ title: t("common.error"), description: t("widgetKit.invalidHistory"), variant: "destructive" });
      return;
    }

    setParsedWidget(payload);

    if (!payload.sourceHasVerseClassFields || payload.fields.length === 0) {
      setGenerated(null);
      setStatus("no_fields");
      return;
    }

    const output = generateVerseOutput(payload);
    setGenerated(output);
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
  const creditCost = getCost("umg_to_verse");

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="space-y-4">
        <Card className="border-border/70 bg-gradient-to-br from-card to-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" />
              Upload UAsset
            </CardTitle>
            <CardDescription>{t("widgetKit.umgVerse.subtitle")}</CardDescription>
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
                accept=".uasset"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void processFile(file);
                }}
              />
              <Upload className="mb-3 h-7 w-7 text-muted-foreground" />
              <p className="font-medium">{t("widgetKit.umgVerse.dropZoneLabel")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("widgetKit.umgVerse.dropZoneHint")}</p>
            </label>

            {isBusy ? (
              <div className="rounded-lg border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t("widgetKit.umgVerse.parsing")}</span>
                </div>
              </div>
            ) : null}

            {status.startsWith("error_") ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {statusMessage(status, t as (key: string) => string)}
              </div>
            ) : null}

            {status === "no_fields" ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <p className="font-medium">{t("widgetKit.umgVerse.noFieldsTitle")}</p>
                <p className="mt-1">{t("widgetKit.umgVerse.noFieldsBody")}</p>
              </div>
            ) : null}

            <Button variant="outline" onClick={resetState}>
              {t("widgetKit.umgVerse.btnNewUpload")}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCode2 className="h-4 w-4" />
              Verse Fields Mapping
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {breakdown && (status === "preview" || status === "ready") ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{parsedWidget?.widgetName}.uasset</Badge>
                  <Badge>{t("widgetKit.umgVerse.fieldsFound", { count: breakdown.total })}</Badge>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">Message: {breakdown.messages}</div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">Boolean: {breakdown.booleans}</div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">Float: {breakdown.floats}</div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">Integer: {breakdown.integers}</div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">Asset: {breakdown.assets}</div>
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-xs">Event: {breakdown.events}</div>
                </div>

                <Button onClick={() => void handleGenerate(true)} className="w-full">
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t("widgetKit.umgVerse.btnGenerate")}
                </Button>
                <div className="flex justify-center">
                  <ToolCostBadge cost={creditCost} />
                </div>
                {insufficientCredits ? <InsufficientCreditsCallout details={insufficientCredits} onDismiss={() => setInsufficientCredits(null)} /> : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Upload a .uasset to map Verse fields and prepare generation.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Verse Output</CardTitle>
            <CardDescription>Manager + core files generated from parsed fields.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {generated ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => downloadTextFile(generated.managerCode, generated.managerFileName)}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("widgetKit.umgVerse.btnDownloadManager")}
                  </Button>
                  <Button variant="outline" onClick={() => downloadTextFile(generated.uiCoreCode, "ui_core.verse")}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("widgetKit.umgVerse.btnDownloadCore")}
                  </Button>
                  <Button variant="outline" onClick={() => void handleCopyAll()}>
                    <Copy className="mr-2 h-4 w-4" />
                    {t("widgetKit.umgVerse.btnCopyAll")}
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{generated.managerFileName}</p>
                  <pre className="max-h-[420px] overflow-auto rounded-xl border border-border/70 bg-black/90 p-4 text-xs text-zinc-100">
                    <code>{generated.managerCode}</code>
                  </pre>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">ui_core.verse</p>
                  <pre className="max-h-[260px] overflow-auto rounded-xl border border-border/70 bg-black/90 p-4 text-xs text-zinc-100">
                    <code>{generated.uiCoreCode}</code>
                  </pre>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Generate Verse to show the code outputs here.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <aside>
        <Card className="sticky top-4 border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              {t("widgetKit.umgVerse.historyTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {historyLoading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : null}
            {!historyLoading && history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("widgetKit.umgVerse.historyEmpty")}</p>
            ) : null}

            {history.map((item) => (
              <div key={item.id} className="rounded-lg border border-border/70 bg-card/40 p-3">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString(locale)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("widgetKit.umgVerse.fieldsFound", { count: metaCount(item, "totalFields", 0) })}
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
