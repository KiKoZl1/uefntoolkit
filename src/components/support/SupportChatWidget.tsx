import { useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { SupportChat } from "@/components/support/SupportChat";
import { countPendingSupportTickets } from "@/lib/support/client";

export function SupportChatWidget() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const shouldHide = useMemo(() => {
    const path = location.pathname;
    return path.startsWith("/auth") || path.startsWith("/admin");
  }, [location.pathname]);

  const pendingTicketsQuery = useQuery({
    queryKey: ["support_widget_pending_tickets", user?.id || "anon"],
    queryFn: async () => await countPendingSupportTickets(),
    enabled: Boolean(user),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  if (!user || shouldHide) return null;

  const trigger = (
    <Button
      size="icon"
      className="group relative h-12 w-12 rounded-full border border-primary/35 bg-background/95 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
      aria-label={t("support.widget.open")}
    >
      <MessageCircle className="h-5 w-5 text-primary transition-transform group-hover:scale-105" />
      {(pendingTicketsQuery.data || 0) > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
        </span>
      ) : null}
    </Button>
  );

  return (
    <div className="fixed bottom-4 right-4 z-[95] sm:bottom-6 sm:right-6">
      {isMobile ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>{trigger}</DrawerTrigger>
          <DrawerContent className="max-h-[92vh] px-0 pb-0">
            <DrawerHeader className="px-4 pb-2 pt-4">
              <DrawerTitle>{t("support.widget.title")}</DrawerTitle>
              <DrawerDescription>{t("support.widget.description")}</DrawerDescription>
            </DrawerHeader>
            <div className="px-3 pb-3">
              <SupportChat mode="widget" allowAnonymous={false} className="min-h-[70vh]" />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side="right" className={cn("w-[420px] max-w-[95vw] border-l border-border/70 bg-background px-3 py-3")}>
            <SheetHeader className="px-1 pb-2 pt-1">
              <SheetTitle>{t("support.widget.title")}</SheetTitle>
              <SheetDescription>{t("support.widget.description")}</SheetDescription>
            </SheetHeader>
            <SupportChat mode="widget" allowAnonymous={false} className="min-h-[78vh]" />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
