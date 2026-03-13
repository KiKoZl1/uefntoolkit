import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { SupportCategory, SupportFaq } from "@/lib/support/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface FaqEditDialogProps {
  open: boolean;
  faq: SupportFaq | null;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    category: SupportCategory;
    question: string;
    answer_md: string;
    published: boolean;
  }) => void;
}

export default function FaqEditDialog({ open, faq, saving, onOpenChange, onSave }: FaqEditDialogProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<SupportCategory>("usage");
  const [question, setQuestion] = useState("");
  const [answerMd, setAnswerMd] = useState("");
  const [published, setPublished] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory((faq?.category as SupportCategory) || "usage");
    setQuestion(String(faq?.question || ""));
    setAnswerMd(String(faq?.answer_md || ""));
    setPublished(Boolean(faq?.published));
  }, [faq, open]);

  const canSave = useMemo(() => question.trim().length > 0 && answerMd.trim().length > 0, [answerMd, question]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{faq ? t("adminSupport.faqEditTitle") : t("adminSupport.faqCreateTitle")}</DialogTitle>
          <DialogDescription>{t("adminSupport.pageSubtitle")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="edit">
          <TabsList>
            <TabsTrigger value="edit">{t("adminSupport.faqTabEdit")}</TabsTrigger>
            <TabsTrigger value="preview">{t("adminSupport.faqTabPreview")}</TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("support.category.other")}</Label>
                <Select value={category} onValueChange={(value) => setCategory(value as SupportCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bug">{t("support.category.bug")}</SelectItem>
                    <SelectItem value="usage">{t("support.category.usage")}</SelectItem>
                    <SelectItem value="billing">{t("support.category.billing")}</SelectItem>
                    <SelectItem value="other">{t("support.category.other")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>{t("common.published")}</Label>
                <div className="flex h-10 items-center rounded-md border border-border/70 px-3">
                  <Switch checked={published} onCheckedChange={setPublished} />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("adminSupport.faqQuestion")}</Label>
              <Input value={question} onChange={(event) => setQuestion(event.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("adminSupport.faqAnswer")}</Label>
              <Textarea value={answerMd} onChange={(event) => setAnswerMd(event.target.value)} className="min-h-[220px]" />
            </div>
          </TabsContent>

          <TabsContent value="preview">
            <div className="rounded-lg border border-border/70 p-4">
              <p className="mb-2 text-sm font-medium">{question || "-"}</p>
              <div className="prose prose-sm max-w-none prose-p:my-2 prose-li:my-1 prose-strong:text-foreground/95">
                <ReactMarkdown>{answerMd || "-"}</ReactMarkdown>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={() => onSave({ category, question: question.trim(), answer_md: answerMd.trim(), published })}
            disabled={!canSave || saving}
          >
            {t("adminSupport.faqSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
