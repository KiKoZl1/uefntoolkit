import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, Send } from "lucide-react";
import { addSupportTicketMessage, listSupportTicketMessages, reopenSupportTicketAsOwner } from "@/lib/support/client";
import { SupportMessage, SupportTicket } from "@/lib/support/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TicketThreadProps {
  ticket: SupportTicket;
  userId: string;
}

function roleLabel(message: SupportMessage, t: (key: string) => string): string {
  if (message.is_ai) return t("support.ticketThreadAiLabel");
  if (message.author_id && message.author_id !== "") return t("support.ticketThreadTeamLabel");
  return t("support.ticketThreadUserLabel");
}

function messageClass(message: SupportMessage, userId: string): string {
  const isOwn = message.author_id === userId && !message.is_ai;
  if (isOwn) return "ml-auto border-primary/30 bg-primary/10";
  if (message.is_ai) return "mr-auto border-blue-500/30 bg-blue-500/10";
  return "mr-auto border-border/70 bg-muted/30";
}

export function TicketThread({ ticket, userId }: TicketThreadProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const messagesQuery = useQuery({
    queryKey: ["support_ticket_messages", ticket.id],
    queryFn: async () => await listSupportTicketMessages(ticket.id),
    staleTime: 10_000,
  });

  const canReply = useMemo(() => ticket.status === "open" || ticket.status === "pending_human" || ticket.status === "resolved", [ticket.status]);

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      await addSupportTicketMessage({
        ticket_id: ticket.id,
        author_id: userId,
        body: text,
        is_ai: false,
      });

      if (ticket.status === "resolved") {
        await reopenSupportTicketAsOwner(ticket.id);
      }
    },
    onSuccess: async () => {
      setBody("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["support_ticket_messages", ticket.id] }),
        queryClient.invalidateQueries({ queryKey: ["support_my_tickets"] }),
      ]);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-xl border border-border/70 bg-card/40">
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{ticket.title || `#${ticket.id.slice(0, 8)}`}</p>
          <Badge variant="outline">{t(`support.status.${ticket.status}`)}</Badge>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-3">
          {messagesQuery.isLoading ? (
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("common.loading")}
            </div>
          ) : null}

          {(messagesQuery.data || []).map((message) => (
            <div key={message.id} className={`max-w-[92%] rounded-xl border px-3 py-2 ${messageClass(message, userId)}`}>
              <p className="mb-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{roleLabel(message, t)}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground/95">{message.body}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{new Date(message.created_at).toLocaleString("pt-BR")}</p>
            </div>
          ))}
        </div>
      </ScrollArea>

      {canReply ? (
        <form onSubmit={onSubmit} className="border-t border-border/70 px-4 py-3">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t("support.ticketReplyPlaceholder")}
            className="min-h-[92px]"
          />
          <div className="mt-2 flex justify-end">
            <Button type="submit" size="sm" disabled={sendMutation.isPending || body.trim().length === 0} className="gap-2">
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("support.ticketReplySend")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
