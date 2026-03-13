import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TicketQueue from "@/pages/admin/support/TicketQueue";
import FaqCms from "@/pages/admin/support/FaqCms";
import AiConfigEditor from "@/pages/admin/support/AiConfigEditor";

export default function AdminSupport() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("tickets");

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-6 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("adminSupport.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("adminSupport.pageSubtitle")}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="tickets">{t("adminSupport.tabTickets")}</TabsTrigger>
          <TabsTrigger value="faq">{t("adminSupport.tabFaq")}</TabsTrigger>
          <TabsTrigger value="ai-config">{t("adminSupport.tabAiConfig")}</TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="mt-4">
          <TicketQueue />
        </TabsContent>

        <TabsContent value="faq" className="mt-4">
          <FaqCms />
        </TabsContent>

        <TabsContent value="ai-config" className="mt-4">
          <AiConfigEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
