import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { loadSupportAiConfig, updateSupportAiConfig } from "@/lib/support/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AiConfigEditor() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const configQuery = useQuery({
    queryKey: ["admin_support_ai_config"],
    queryFn: async () => await loadSupportAiConfig(),
    staleTime: 10_000,
  });

  const [openrouterModel, setOpenrouterModel] = useState("openai/gpt-4o");
  const [temperature, setTemperature] = useState(0.4);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.6);
  const [systemPromptBase, setSystemPromptBase] = useState("");

  useEffect(() => {
    if (!configQuery.data) return;
    setOpenrouterModel(String(configQuery.data.openrouter_model || "openai/gpt-4o"));
    setTemperature(Number(configQuery.data.temperature || 0.4));
    setMaxTokens(Number(configQuery.data.max_tokens || 1024));
    setConfidenceThreshold(Number(configQuery.data.confidence_threshold || 0.6));
    setSystemPromptBase(String(configQuery.data.system_prompt_base || ""));
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await updateSupportAiConfig({
        openrouter_model: openrouterModel,
        temperature,
        max_tokens: maxTokens,
        confidence_threshold: confidenceThreshold,
        system_prompt_base: systemPromptBase,
      });
    },
    onSuccess: () => {
      toast({ title: t("adminSupport.aiConfigSaved") });
      void configQuery.refetch();
    },
  });

  const missingPlaceholders = useMemo(() => {
    return !systemPromptBase.includes("{faq_context}") || !systemPromptBase.includes("{rag_context}");
  }, [systemPromptBase]);

  return (
    <Card className="border-border/70 bg-card/40">
      <CardContent className="space-y-4 py-4">
        {configQuery.isLoading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : null}

        {missingPlaceholders ? (
          <Alert>
            <AlertDescription>{t("adminSupport.aiConfigPromptWarning")}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-1.5">
          <Label>{t("adminSupport.aiConfigModel")}</Label>
          <Input value={openrouterModel} onChange={(event) => setOpenrouterModel(event.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label>{t("adminSupport.aiConfigTemperature")} ({temperature.toFixed(2)})</Label>
          <Slider value={[temperature]} min={0} max={1} step={0.05} onValueChange={(value) => setTemperature(Number(value[0] || 0))} />
        </div>

        <div className="space-y-1.5">
          <Label>{t("adminSupport.aiConfigMaxTokens")}</Label>
          <Input
            type="number"
            min={256}
            max={4096}
            value={maxTokens}
            onChange={(event) => setMaxTokens(Math.min(4096, Math.max(256, Number(event.target.value || 1024))))}
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t("adminSupport.aiConfigThreshold")} ({confidenceThreshold.toFixed(2)})</Label>
          <Slider
            value={[confidenceThreshold]}
            min={0}
            max={1}
            step={0.05}
            onValueChange={(value) => setConfidenceThreshold(Number(value[0] || 0))}
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t("adminSupport.aiConfigPrompt")}</Label>
          <Textarea
            value={systemPromptBase}
            onChange={(event) => setSystemPromptBase(event.target.value)}
            className="min-h-[260px] font-mono text-xs"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {t("adminSupport.aiConfigSave")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
