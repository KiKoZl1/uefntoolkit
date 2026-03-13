import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SupportFaq } from "@/components/support/SupportFaq";
import { SupportChat } from "@/components/support/SupportChat";
import { SupportTickets } from "@/components/support/SupportTickets";

const TAB_VALUES = ["faq", "chat", "tickets"] as const;
type SupportTab = (typeof TAB_VALUES)[number];

function isSupportTab(value: string | null): value is SupportTab {
  return value === "faq" || value === "chat" || value === "tickets";
}

export default function Support() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = useMemo<SupportTab>(() => {
    const param = searchParams.get("tab");
    if (isSupportTab(param)) return param;
    return "faq";
  }, [searchParams]);

  function setTab(tab: SupportTab) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <div className="mb-5 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("support.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("support.pageSubtitle")}</p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setTab((isSupportTab(value) ? value : "faq"))}>
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="faq">{t("support.tabFaq")}</TabsTrigger>
          <TabsTrigger value="chat">{t("support.tabChat")}</TabsTrigger>
          <TabsTrigger value="tickets">{t("support.tabTickets")}</TabsTrigger>
        </TabsList>

        <TabsContent value="faq" className="mt-4">
          <SupportFaq onOpenChat={() => setTab("chat")} />
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <SupportChat mode="page" allowAnonymous />
        </TabsContent>

        <TabsContent value="tickets" className="mt-4">
          <SupportTickets />
        </TabsContent>
      </Tabs>
    </div>
  );
}
