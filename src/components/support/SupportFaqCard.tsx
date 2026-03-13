import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import { SupportFaq } from "@/lib/support/types";

interface SupportFaqCardProps {
  faq: Pick<SupportFaq, "id" | "question" | "answer_md" | "category">;
  onNotHelpful?: (question: string) => void;
}

export function SupportFaqCard({ faq, onNotHelpful }: SupportFaqCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm leading-5 text-foreground/95">{faq.question}</CardTitle>
          <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-[0.12em]">
            {t(`support.category.${faq.category}`)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => setOpen((prev) => !prev)}
        >
          <ChevronDown className={cn("mr-1 h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          {open ? t("support.chat.hideAnswer") : t("support.chat.showAnswer")}
        </Button>

        {open ? (
          <div className="prose prose-sm max-w-none prose-p:my-2 prose-li:my-1 prose-strong:text-foreground/95 prose-headings:text-foreground/95">
            <ReactMarkdown>{faq.answer_md}</ReactMarkdown>
          </div>
        ) : null}

        {open && onNotHelpful ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onNotHelpful(faq.question)}>
            <CircleHelp className="mr-1 h-3.5 w-3.5" />
            {t("support.chat.notHelpful")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
