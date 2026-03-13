import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createSupportFaq,
  deleteSupportFaq,
  listAdminSupportFaqs,
  reorderSupportFaqs,
  updateSupportFaq,
} from "@/lib/support/client";
import { SupportFaq } from "@/lib/support/types";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import FaqEditDialog from "@/pages/admin/support/FaqEditDialog";

export default function FaqCms() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<SupportFaq | null>(null);

  const faqsQuery = useQuery({
    queryKey: ["admin_support_faqs"],
    queryFn: async () => await listAdminSupportFaqs(),
    staleTime: 5_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (input: { category: SupportFaq["category"]; question: string; answer_md: string; published: boolean }) => {
      if (editingFaq) {
        await updateSupportFaq(editingFaq.id, input);
      } else {
        const sortOrder = (faqsQuery.data?.length || 0) + 1;
        await createSupportFaq({
          ...input,
          sort_order: sortOrder,
          created_by: user?.id || null,
        });
      }
    },
    onSuccess: async () => {
      setDialogOpen(false);
      setEditingFaq(null);
      await queryClient.invalidateQueries({ queryKey: ["admin_support_faqs"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (faqId: string) => await deleteSupportFaq(faqId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin_support_faqs"] });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (args: { faqId: string; published: boolean }) => {
      await updateSupportFaq(args.faqId, { published: args.published });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin_support_faqs"] });
    },
  });

  const sortedFaqs = useMemo(() => [...(faqsQuery.data || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)), [faqsQuery.data]);

  async function moveFaq(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sortedFaqs.length) return;

    const reordered = [...sortedFaqs];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);

    await reorderSupportFaqs(reordered.map((faq, i) => ({ id: faq.id, sort_order: i + 1 })));
    await queryClient.invalidateQueries({ queryKey: ["admin_support_faqs"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          className="gap-2"
          onClick={() => {
            setEditingFaq(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {t("adminSupport.faqNewButton")}
        </Button>
      </div>

      <Card className="border-border/70 bg-card/40">
        <CardContent className="space-y-2 py-4">
          {faqsQuery.isLoading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : null}

          {sortedFaqs.map((faq, index) => (
            <div key={faq.id} className="rounded-lg border border-border/70 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{t(`support.category.${faq.category}`)}</Badge>
                  <Badge variant="outline" className={faq.published ? "text-emerald-400 border-emerald-500/40" : "text-muted-foreground"}>
                    {faq.published ? t("common.published") : t("common.draft")}
                  </Badge>
                </div>

                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" onClick={() => void moveFaq(index, -1)} disabled={index === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => void moveFaq(index, 1)} disabled={index === sortedFaqs.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <div className="mx-1 flex items-center rounded-md border border-border/70 px-2">
                    <Switch
                      checked={Boolean(faq.published)}
                      onCheckedChange={(checked) => publishMutation.mutate({ faqId: faq.id, published: checked })}
                    />
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => { setEditingFaq(faq); setDialogOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (!window.confirm(t("adminSupport.faqDeleteConfirm"))) return;
                      deleteMutation.mutate(faq.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <p className="text-sm font-medium text-foreground">{faq.question}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{faq.answer_md}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <FaqEditDialog
        open={dialogOpen}
        faq={editingFaq}
        saving={saveMutation.isPending}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen);
          if (!nextOpen) setEditingFaq(null);
        }}
        onSave={(input) => saveMutation.mutate(input)}
      />
    </div>
  );
}
