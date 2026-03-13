import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import TicketQueue from "@/pages/admin/support/TicketQueue";

export default function AdminSupportTicket() {
  const { t } = useTranslation();
  const params = useParams();
  const ticketId = String(params.id || "").trim();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-6 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("adminSupport.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{ticketId}</p>
      </div>
      <TicketQueue initialTicketId={ticketId} />
    </div>
  );
}
