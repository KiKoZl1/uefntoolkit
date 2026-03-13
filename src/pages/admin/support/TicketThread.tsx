import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Copy, Loader2, Send } from "lucide-react";
import {
  addSupportTicketMessage,
  listAssignableSupportAgents,
  listSupportTicketMessages,
  updateSupportTicketAdmin,
} from "@/lib/support/client";
import { SupportTicket, SupportTicketStatus } from "@/lib/support/types";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface AdminSupportThreadProps {
  ticket: SupportTicket;
  onTicketChanged?: () => void;
}

function statusLabel(status: SupportTicketStatus, t: (key: string) => string) {
  if (status === "open") return t("support.status.open");
  if (status === "pending_human") return t("support.status.pending_human");
  if (status === "resolved") return t("support.status.resolved");
  return t("support.status.ai_resolved");
}

function statusBadgeClass(status: SupportTicketStatus): string {
  if (status === "open") return "border-yellow-500/40 text-yellow-400";
  if (status === "pending_human") return "border-orange-500/40 text-orange-400";
  if (status === "resolved") return "border-emerald-500/40 text-emerald-400";
  return "border-blue-500/40 text-blue-400";
}

export default function TicketThread({ ticket, onTicketChanged }: AdminSupportThreadProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");

  const messagesQuery = useQuery({
    queryKey: ["admin_support_ticket_messages", ticket.id],
    queryFn: async () => await listSupportTicketMessages(ticket.id),
    staleTime: 5_000,
  });

  const agentsQuery = useQuery({
    queryKey: ["admin_support_agents"],
    queryFn: async () => await listAssignableSupportAgents(),
    staleTime: 60_000,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: SupportTicketStatus) => {
      await updateSupportTicketAdmin(ticket.id, { status });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin_support_tickets"] }),
        queryClient.invalidateQueries({ queryKey: ["admin_support_ticket", ticket.id] }),
      ]);
      onTicketChanged?.();
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (assignedTo: string | null) => {
      await updateSupportTicketAdmin(ticket.id, { assigned_to: assignedTo });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin_support_tickets"] });
      onTicketChanged?.();
    },
  });

  const replyMutation = useMutation({
    mutationFn: async (text: string) => {
      await addSupportTicketMessage({
        ticket_id: ticket.id,
        author_id: user?.id || null,
        body: text,
        is_ai: false,
      });

      await updateSupportTicketAdmin(ticket.id, {
        assigned_to: ticket.assigned_to || user?.id || null,
      });
    },
    onSuccess: async () => {
      setReply("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin_support_ticket_messages", ticket.id] }),
        queryClient.invalidateQueries({ queryKey: ["admin_support_tickets"] }),
      ]);
      onTicketChanged?.();
    },
  });

  const sortedAgents = useMemo(() => {
    const rows = agentsQuery.data || [];
    return rows.map((agent) => ({
      ...agent,
      label: `${agent.role.toUpperCase()} - ${agent.user_id.slice(0, 8)}`,
    }));
  }, [agentsQuery.data]);

  return (
    <div className="flex h-full min-h-[520px] flex-col rounded-xl border border-border/70 bg-card/40">
      <div className="space-y-3 border-b border-border/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{ticket.title || `#${ticket.id.slice(0, 8)}`}</p>
            <p className="text-xs text-muted-foreground">{ticket.anon_email || ticket.user_id || t("adminSupport.ticketAnonymous")}</p>
          </div>
          <Badge variant="outline" className={statusBadgeClass(ticket.status)}>{statusLabel(ticket.status, t)}</Badge>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Select
            value={ticket.status}
            onValueChange={(value) => statusMutation.mutate(value as SupportTicketStatus)}
            disabled={statusMutation.isPending}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("common.status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{t("support.status.open")}</SelectItem>
              <SelectItem value="pending_human">{t("support.status.pending_human")}</SelectItem>
              <SelectItem value="resolved">{t("support.status.resolved")}</SelectItem>
              <SelectItem value="ai_resolved">{t("support.status.ai_resolved")}</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={ticket.assigned_to || "unassigned"}
            onValueChange={(value) => assignMutation.mutate(value === "unassigned" ? null : value)}
            disabled={assignMutation.isPending}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("adminSupport.ticketAssignTo")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">{t("adminSupport.ticketUnassigned")}</SelectItem>
              {sortedAgents.map((agent) => (
                <SelectItem key={agent.user_id} value={agent.user_id}>{agent.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            className="gap-2"
            onClick={async () => {
              await navigator.clipboard.writeText(ticket.id);
            }}
          >
            <Copy className="h-4 w-4" />
            {t("common.copyLink")}
          </Button>
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

          {(messagesQuery.data || []).map((message) => {
            const ownAdmin = user?.id && message.author_id === user.id && !message.is_ai;
            const bubbleClass = ownAdmin
              ? "ml-auto border-primary/30 bg-primary/10"
              : message.is_ai
                ? "mr-auto border-blue-500/30 bg-blue-500/10"
                : "mr-auto border-border/70 bg-muted/30";

            const label = message.is_ai
              ? t("support.ticketThreadAiLabel")
              : ownAdmin
                ? t("adminSupport.ticketThreadYou")
                : t("support.ticketThreadTeamLabel");

            return (
              <div key={message.id} className={`max-w-[92%] rounded-xl border px-3 py-2 ${bubbleClass}`}>
                <p className="mb-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
                <p className="whitespace-pre-wrap text-sm text-foreground/95">{message.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{new Date(message.created_at).toLocaleString("pt-BR")}</p>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="space-y-2 border-t border-border/70 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => statusMutation.mutate("resolved")}
            disabled={statusMutation.isPending || ticket.status === "resolved"}
          >
            {t("adminSupport.ticketMarkResolved")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => statusMutation.mutate("open")}
            disabled={statusMutation.isPending || ticket.status === "open"}
          >
            {t("adminSupport.ticketReopen")}
          </Button>
        </div>

        <Textarea
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder={t("adminSupport.ticketReplyPlaceholder")}
          className="min-h-[92px]"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => replyMutation.mutate(reply.trim())}
            disabled={replyMutation.isPending || reply.trim().length === 0}
            className="gap-2"
          >
            {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("adminSupport.ticketReplySend")}
          </Button>
        </div>
      </div>
    </div>
  );
}
