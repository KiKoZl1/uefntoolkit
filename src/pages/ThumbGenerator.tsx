import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2, Download, Copy, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { TgisGenerateResponse, TgisImageVariant } from "@/types/tgis";

type ClusterRow = {
  cluster_id: number;
  cluster_name: string;
  categories_json: string[];
};

const PROMPT_MAX = 200;

export default function ThumbGenerator() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("");
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [result, setResult] = useState<TgisGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("tgis_cluster_registry")
        .select("cluster_id,cluster_name,categories_json")
        .eq("is_active", true)
        .order("cluster_id", { ascending: true });
      if (!mounted) return;
      if (error) {
        setError(error.message);
        return;
      }
      const rows: ClusterRow[] = Array.isArray(data)
        ? data.map((r: any) => ({
            cluster_id: Number(r.cluster_id),
            cluster_name: String(r.cluster_name || ""),
            categories_json: Array.isArray(r.categories_json) ? r.categories_json.map((x: any) => String(x)) : [],
          }))
        : [];
      setClusters(rows);
      const firstCategory = rows.flatMap((r) => r.categories_json)[0] || "";
      setCategory(firstCategory);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const row of clusters) {
      for (const c of row.categories_json) set.add(c);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [clusters]);

  function copyRewrittenPrompt() {
    const value = result?.rewritten_prompt;
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      toast({ title: t("thumbGenerator.promptCopied") });
    });
  }

  async function handleGenerate(ev?: FormEvent) {
    ev?.preventDefault();
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setError(t("thumbGenerator.errors.missingPrompt"));
      return;
    }
    if (!category) {
      setError(t("thumbGenerator.errors.missingCategory"));
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("tgis-generate", {
      body: {
        prompt: cleanPrompt,
        category,
        variants: 4,
        aspect_ratio: "16:9",
      },
    });
    setLoading(false);

    if (error || data?.success === false) {
      setError(error?.message || data?.error || t("thumbGenerator.errors.generationFailed"));
      return;
    }
    setResult(data as TgisGenerateResponse);
  }

  function downloadImage(v: TgisImageVariant, idx: number) {
    const a = document.createElement("a");
    a.href = v.url;
    a.download = `tgis-thumb-${result?.generation_id || "unknown"}-${idx + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("thumbGenerator.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("thumbGenerator.subtitle")}</p>
        </div>
        <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
          {t("thumbGenerator.betaClosed")}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("thumbGenerator.formTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleGenerate}>
            <div className="space-y-2">
              <Label>{t("thumbGenerator.category")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder={t("thumbGenerator.selectCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("thumbGenerator.prompt")}</Label>
              <Textarea
                value={prompt}
                maxLength={PROMPT_MAX}
                onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
                placeholder={t("thumbGenerator.promptPlaceholder")}
                className="min-h-28"
              />
              <p className="text-xs text-muted-foreground">
                {prompt.length}/{PROMPT_MAX}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={loading} className="gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {loading ? t("thumbGenerator.generating") : t("thumbGenerator.generate")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleGenerate()} disabled={loading || !result}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("thumbGenerator.regenerate")}
              </Button>
              <Button type="button" variant="outline" onClick={copyRewrittenPrompt} disabled={!result?.rewritten_prompt}>
                <Copy className="mr-2 h-4 w-4" />
                {t("thumbGenerator.copyPrompt")}
              </Button>
            </div>

            {error ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {result?.images?.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("thumbGenerator.resultsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {result.images.map((img, idx) => (
                <div key={`${img.url}:${idx}`} className="overflow-hidden rounded-lg border border-border/70 bg-card/30">
                  <img src={img.url} alt={`thumb-${idx + 1}`} className="aspect-video w-full object-cover" loading="lazy" />
                  <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                    <span>seed: {img.seed}</span>
                    <Button size="sm" variant="ghost" onClick={() => downloadImage(img, idx)}>
                      <Download className="mr-1 h-3.5 w-3.5" />
                      {t("thumbGenerator.download")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <Card className="border-border/60 bg-card/40">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{t("thumbGenerator.cluster")}</p>
                  <p className="mt-1 text-sm font-semibold">{result.cluster_name || "-"}</p>
                </CardContent>
              </Card>
              <Card className="border-border/60 bg-card/40">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{t("thumbGenerator.modelVersion")}</p>
                  <p className="mt-1 text-sm font-semibold">{result.model_version || "-"}</p>
                </CardContent>
              </Card>
              <Card className="border-border/60 bg-card/40">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{t("thumbGenerator.cost")}</p>
                  <p className="mt-1 text-sm font-semibold">${Number(result.cost_usd || 0).toFixed(4)}</p>
                </CardContent>
              </Card>
              <Card className="border-border/60 bg-card/40">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{t("thumbGenerator.latency")}</p>
                  <p className="mt-1 text-sm font-semibold">{Math.round(Number(result.latency_ms || 0))}ms</p>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
