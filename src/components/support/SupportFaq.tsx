import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { Search } from "lucide-react";
import { listPublishedSupportFaqs } from "@/lib/support/client";
import { SupportCategory } from "@/lib/support/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SupportFaqProps {
  onOpenChat: () => void;
}

const CATEGORIES: Array<SupportCategory | "all"> = ["all", "bug", "usage", "billing", "other"];

export function SupportFaq({ onOpenChat }: SupportFaqProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SupportCategory | "all">("all");

  const faqsQuery = useQuery({
    queryKey: ["support_faqs_public"],
    queryFn: async () => await listPublishedSupportFaqs(),
    staleTime: 5 * 60 * 1000,
  });

  const filteredFaqs = useMemo(() => {
    const list = faqsQuery.data || [];
    const q = query.trim().toLowerCase();
    return list.filter((faq) => {
      if (category !== "all" && faq.category !== category) return false;
      if (!q) return true;
      return `${faq.question} ${faq.answer_md}`.toLowerCase().includes(q);
    });
  }, [category, faqsQuery.data, query]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-border/70 bg-card/40 p-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("support.faqSearchPlaceholder")}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map((item) => (
            <Button
              key={item}
              type="button"
              variant={category === item ? "default" : "outline"}
              size="sm"
              onClick={() => setCategory(item)}
            >
              {item === "all" ? t("support.faqCategoryAll") : t(`support.category.${item}`)}
            </Button>
          ))}
        </div>
      </div>

      {faqsQuery.isLoading ? (
        <Card className="border-border/70 bg-card/40">
          <CardContent className="py-8 text-sm text-muted-foreground">{t("common.loading")}</CardContent>
        </Card>
      ) : null}

      {!faqsQuery.isLoading && filteredFaqs.length === 0 ? (
        <Card className="border-border/70 bg-card/40">
          <CardContent className="space-y-4 py-8 text-sm">
            <p className="text-muted-foreground">{t("support.faqEmpty")}</p>
            <Button onClick={onOpenChat}>{t("support.faqOpenChat")}</Button>
          </CardContent>
        </Card>
      ) : null}

      {filteredFaqs.length > 0 ? (
        <Card className="border-border/70 bg-card/40">
          <CardContent className="pt-3">
            <Accordion type="multiple" className="w-full">
              {filteredFaqs.map((faq) => (
                <AccordionItem key={faq.id} value={faq.id}>
                  <AccordionTrigger className="text-left">
                    <span className="mr-2 inline-flex">
                      <Badge variant="outline" className="mr-2 text-[10px] uppercase tracking-[0.1em]">
                        {t(`support.category.${faq.category}`)}
                      </Badge>
                    </span>
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="prose prose-sm max-w-none prose-p:my-2 prose-li:my-1 prose-strong:text-foreground/95">
                      <ReactMarkdown>{faq.answer_md}</ReactMarkdown>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-primary/25 bg-primary/5">
        <CardContent className="flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-medium">{t("support.faqStillNeedHelp")}</p>
            <p className="text-xs text-muted-foreground">{t("support.pageSubtitle")}</p>
          </div>
          <Button onClick={onOpenChat}>{t("support.faqOpenChat")}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
