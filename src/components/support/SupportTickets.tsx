import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listMySupportTickets } from "@/lib/support/client";
import { SupportTicket } from "@/lib/support/types";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TicketCard } from "@/components/support/TicketCard";
import { TicketThread } from "@/components/support/TicketThread";

export function SupportTickets() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ["support_my_tickets", user?.id || "anon"],
    queryFn: async () => await listMySupportTickets(),
    enabled: Boolean(user),
    staleTime: 10_000,
  });

  const tickets = useMemo(() => ticketsQuery.data || [], [ticketsQuery.data]);

  if (!user) {
    return (
      <Card className="border-border/70 bg-card/40">
        <CardContent className="space-y-3 py-8">
          <p className="text-sm text-muted-foreground">{t("support.ticketsSignInPrompt")}</p>
          <Button asChild>
            <Link to="/auth">{t("nav.signIn")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card className="border-border/70 bg-card/40">
        <CardContent className="space-y-3 py-4">
          {ticketsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : null}

          {!ticketsQuery.isLoading && tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("support.ticketsEmpty")}</p>
          ) : null}

          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} onViewThread={setSelectedTicket} />
          ))}
        </CardContent>
      </Card>

      {!isMobile ? (
        selectedTicket ? (
          <TicketThread ticket={selectedTicket} userId={user.id} />
        ) : (
          <Card className="border-border/70 bg-card/40">
            <CardContent className="py-8 text-sm text-muted-foreground">{t("support.ticketSelectPrompt")}</CardContent>
          </Card>
        )
      ) : (
        <Sheet open={Boolean(selectedTicket)} onOpenChange={(open) => { if (!open) setSelectedTicket(null); }}>
          <SheetContent side="right" className="w-[95vw] max-w-[95vw] px-3 py-3">
            <SheetHeader className="px-1 pb-2 pt-1">
              <SheetTitle>{t("support.ticketViewThread")}</SheetTitle>
              <SheetDescription>{selectedTicket?.id || ""}</SheetDescription>
            </SheetHeader>
            {selectedTicket ? <TicketThread ticket={selectedTicket} userId={user.id} /> : null}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
