import { Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";

interface AiNarrativeProps {
  text: string | null | undefined;
}

export function AiNarrative({ text }: AiNarrativeProps) {
  const { t } = useTranslation();
  if (!text) return null;

  return (
    <div className="rounded-lg border border-primary/15 bg-primary/5 p-5 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-semibold text-primary uppercase tracking-widest">{t("aiNarrative.label")}</span>
      </div>
      <div className="prose prose-sm prose-invert max-w-none text-foreground/80 leading-relaxed">
        <ReactMarkdown>{text}</ReactMarkdown>
      </div>
    </div>
  );
}
