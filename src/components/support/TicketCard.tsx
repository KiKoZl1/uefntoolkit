import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SupportTicket } from "@/lib/support/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface TicketCardProps {
  ticket: SupportTicket;
  onViewThread: (ticket: SupportTicket) => void;
}

function statusBadgeClass(status: SupportTicket["status"]): string {
  if (status === "open") return "border-yellow-500/40 text-yellow-400";
  if (status === "pending_human") return "border-orange-500/40 text-orange-400";
  if (status === "resolved") return "border-emerald-500/40 text-emerald-400";
  return "border-blue-500/40 text-blue-400";
}

function relativeDate(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

export function TicketCard({ ticket, onViewThread }: TicketCardProps) {
  const { t } = useTranslation();

  const title = useMemo(() => {
    const value = String(ticket.title || "").trim();
    if (value) return value;
    return `${t("support.tabTickets")} #${ticket.id.slice(0, 8)}`;
  }, [t, ticket.id, ticket.title]);

  return (
    <Card className="border-border/70 bg-card/40">
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={statusBadgeClass(ticket.status)}>
            {t(`support.status.${ticket.status}`)}
          </Badge>
          <Badge variant="outline">{t(`support.category.${ticket.category}`)}</Badge>
        </div>

        <div>
          <p className="line-clamp-2 text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{relativeDate(ticket.created_at)}</p>
        </div>

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => onViewThread(ticket)}>
            {t("support.ticketViewThread")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
