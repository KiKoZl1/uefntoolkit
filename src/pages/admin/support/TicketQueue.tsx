import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { listAdminSupportTickets } from "@/lib/support/client";
import { SupportCategory, SupportTicket, SupportTicketStatus } from "@/lib/support/types";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TicketThread from "@/pages/admin/support/TicketThread";

interface TicketQueueProps {
  initialTicketId?: string;
}

function statusRank(status: SupportTicketStatus): number {
  if (status === "pending_human") return 0;
  if (status === "open") return 1;
  if (status === "ai_resolved") return 2;
  return 3;
}

function statusBadgeClass(status: SupportTicketStatus): string {
  if (status === "open") return "border-yellow-500/40 text-yellow-400";
  if (status === "pending_human") return "border-orange-500/40 text-orange-400";
  if (status === "resolved") return "border-emerald-500/40 text-emerald-400";
  return "border-blue-500/40 text-blue-400";
}

export default function TicketQueue({ initialTicketId }: TicketQueueProps) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | "all">("pending_human");
  const [categoryFilter, setCategoryFilter] = useState<SupportCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(initialTicketId || null);

  const ticketsQuery = useQuery({
    queryKey: ["admin_support_tickets"],
    queryFn: async () => await listAdminSupportTickets(200),
    staleTime: 5_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!selectedTicketId && ticketsQuery.data?.length) {
      setSelectedTicketId(ticketsQuery.data[0].id);
    }
  }, [selectedTicketId, ticketsQuery.data]);

  useEffect(() => {
    if (initialTicketId) setSelectedTicketId(initialTicketId);
  }, [initialTicketId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (ticketsQuery.data || []).filter((ticket) => {
      if (statusFilter !== "all" && ticket.status !== statusFilter) return false;
      if (categoryFilter !== "all" && ticket.category !== categoryFilter) return false;
      if (!q) return true;
      return `${ticket.title} ${ticket.page_url || ""} ${ticket.anon_email || ""} ${ticket.user_id || ""}`.toLowerCase().includes(q);
    });

    return [...list].sort((a, b) => {
      const rank = statusRank(a.status) - statusRank(b.status);
      if (rank !== 0) return rank;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [categoryFilter, search, statusFilter, ticketsQuery.data]);

  const selectedTicket: SupportTicket | null = useMemo(() => {
    return filtered.find((ticket) => ticket.id === selectedTicketId) || null;
  }, [filtered, selectedTicketId]);

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card className="border-border/70 bg-card/40">
        <CardContent className="space-y-3 py-4">
          <div className="grid gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("common.search")}
                className="pl-9"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("common.status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("adminSupport.ticketFilterAll")}</SelectItem>
                  <SelectItem value="open">{t("adminSupport.ticketFilterOpen")}</SelectItem>
                  <SelectItem value="pending_human">{t("adminSupport.ticketFilterPending")}</SelectItem>
                  <SelectItem value="resolved">{t("adminSupport.ticketFilterResolved")}</SelectItem>
                  <SelectItem value="ai_resolved">{t("support.status.ai_resolved")}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as any)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("support.faqCategoryAll")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("support.faqCategoryAll")}</SelectItem>
                  <SelectItem value="bug">{t("support.category.bug")}</SelectItem>
                  <SelectItem value="usage">{t("support.category.usage")}</SelectItem>
                  <SelectItem value="billing">{t("support.category.billing")}</SelectItem>
                  <SelectItem value="other">{t("support.category.other")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {ticketsQuery.isLoading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : null}

          {filtered.length === 0 && !ticketsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("adminSupport.ticketsEmpty")}</p>
          ) : null}

          <div className="space-y-2">
            {filtered.map((ticket) => {
              const selected = ticket.id === selectedTicketId;
              return (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => setSelectedTicketId(ticket.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${selected ? "border-primary/45 bg-primary/10" : "border-border/70 hover:bg-muted/30"}`}
                >
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Badge variant="outline" className={statusBadgeClass(ticket.status)}>{t(`support.status.${ticket.status}`)}</Badge>
                    <Badge variant="outline">{t(`support.category.${ticket.category}`)}</Badge>
                  </div>
                  <p className="line-clamp-2 text-sm font-medium text-foreground">{ticket.title || `#${ticket.id.slice(0, 8)}`}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{ticket.anon_email || ticket.user_id || t("adminSupport.ticketAnonymous")}</p>
                  {ticket.page_url ? <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{ticket.page_url}</p> : null}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {selectedTicket ? (
        <TicketThread ticket={selectedTicket} onTicketChanged={() => ticketsQuery.refetch()} />
      ) : (
        <Card className="border-border/70 bg-card/40">
          <CardContent className="py-8 text-sm text-muted-foreground">{t("support.ticketSelectPrompt")}</CardContent>
        </Card>
      )}
    </div>
  );
}
