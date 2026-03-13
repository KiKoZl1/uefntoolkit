import { supabase } from "@/integrations/supabase/client";
import {
  SupportAiConfig,
  SupportFaq,
  SupportMessage,
  SupportResponderRequest,
  SupportResponderResponse,
  SupportTicket,
} from "@/lib/support/types";

function toSupportError(error: unknown, fallback = "support_request_failed") {
  if (error && typeof error === "object") {
    const anyError = error as Record<string, unknown>;
    const message = String(anyError.message || anyError.error_description || anyError.error || "").trim();
    if (message) return new Error(message);
  }
  return new Error(fallback);
}

function asClient() {
  return supabase as any;
}

export async function invokeSupportAiResponder(payload: SupportResponderRequest): Promise<SupportResponderResponse> {
  const { data, error } = await supabase.functions.invoke("support-ai-responder", {
    body: payload,
  });

  if (error || !data) throw toSupportError(error || data, "support_ai_responder_failed");
  if ((data as any).error) throw new Error(String((data as any).error));
  return data as SupportResponderResponse;
}

export async function listPublishedSupportFaqs(limit?: number): Promise<SupportFaq[]> {
  let query = asClient()
    .from("support_faqs")
    .select("id,category,question,answer_md,published,sort_order,created_at,updated_at")
    .eq("published", true)
    .order("sort_order", { ascending: true });

  if (limit && Number.isFinite(limit) && limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw toSupportError(error, "support_faqs_load_failed");
  return (Array.isArray(data) ? data : []) as SupportFaq[];
}

export async function listAdminSupportFaqs(): Promise<SupportFaq[]> {
  const { data, error } = await asClient()
    .from("support_faqs")
    .select("id,category,question,answer_md,published,sort_order,created_at,updated_at")
    .order("sort_order", { ascending: true });

  if (error) throw toSupportError(error, "admin_support_faqs_load_failed");
  return (Array.isArray(data) ? data : []) as SupportFaq[];
}

export async function createSupportFaq(input: {
  category: SupportFaq["category"];
  question: string;
  answer_md: string;
  published: boolean;
  sort_order: number;
  created_by: string | null;
}): Promise<SupportFaq> {
  const { data, error } = await asClient()
    .from("support_faqs")
    .insert(input)
    .select("id,category,question,answer_md,published,sort_order,created_at,updated_at")
    .single();

  if (error || !data) throw toSupportError(error, "support_faq_create_failed");
  return data as SupportFaq;
}

export async function updateSupportFaq(faqId: string, input: Partial<Omit<SupportFaq, "id" | "created_at">>): Promise<void> {
  const { error } = await asClient()
    .from("support_faqs")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", faqId);

  if (error) throw toSupportError(error, "support_faq_update_failed");
}

export async function deleteSupportFaq(faqId: string): Promise<void> {
  const { error } = await asClient().from("support_faqs").delete().eq("id", faqId);
  if (error) throw toSupportError(error, "support_faq_delete_failed");
}

export async function reorderSupportFaqs(faqs: Array<{ id: string; sort_order: number }>): Promise<void> {
  const { error } = await asClient().from("support_faqs").upsert(faqs);
  if (error) throw toSupportError(error, "support_faq_reorder_failed");
}

export async function listMySupportTickets(): Promise<SupportTicket[]> {
  const { data, error } = await asClient()
    .from("support_tickets")
    .select("id,user_id,anon_email,category,status,title,page_url,assigned_to,created_at,updated_at,resolved_at")
    .order("created_at", { ascending: false });

  if (error) throw toSupportError(error, "support_tickets_load_failed");
  return (Array.isArray(data) ? data : []) as SupportTicket[];
}

export async function listAdminSupportTickets(limit = 200): Promise<SupportTicket[]> {
  const { data, error } = await asClient()
    .from("support_tickets")
    .select("id,user_id,anon_email,category,status,title,page_url,assigned_to,created_at,updated_at,resolved_at")
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));

  if (error) throw toSupportError(error, "admin_support_tickets_load_failed");
  return (Array.isArray(data) ? data : []) as SupportTicket[];
}

export async function getSupportTicket(ticketId: string): Promise<SupportTicket | null> {
  const { data, error } = await asClient()
    .from("support_tickets")
    .select("id,user_id,anon_email,category,status,title,page_url,assigned_to,created_at,updated_at,resolved_at")
    .eq("id", ticketId)
    .maybeSingle();

  if (error) throw toSupportError(error, "support_ticket_load_failed");
  return (data || null) as SupportTicket | null;
}

export async function listSupportTicketMessages(ticketId: string): Promise<SupportMessage[]> {
  const { data, error } = await asClient()
    .from("support_messages")
    .select("id,ticket_id,author_id,body,is_ai,created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) throw toSupportError(error, "support_messages_load_failed");
  return (Array.isArray(data) ? data : []) as SupportMessage[];
}

export async function addSupportTicketMessage(input: {
  ticket_id: string;
  author_id: string | null;
  body: string;
  is_ai?: boolean;
}): Promise<void> {
  const { error } = await asClient()
    .from("support_messages")
    .insert({
      ticket_id: input.ticket_id,
      author_id: input.author_id,
      body: input.body,
      is_ai: Boolean(input.is_ai),
    });

  if (error) throw toSupportError(error, "support_message_send_failed");
}

export async function reopenSupportTicketAsOwner(ticketId: string): Promise<void> {
  const { error } = await asClient()
    .from("support_tickets")
    .update({ status: "open", updated_at: new Date().toISOString(), resolved_at: null })
    .eq("id", ticketId);

  if (error) throw toSupportError(error, "support_ticket_reopen_failed");
}

export async function updateSupportTicketAdmin(
  ticketId: string,
  updates: Partial<Pick<SupportTicket, "status" | "assigned_to" | "title">>,
): Promise<void> {
  const patch: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  if (updates.status === "resolved") {
    patch.resolved_at = new Date().toISOString();
  } else if (updates.status) {
    patch.resolved_at = null;
  }

  const { error } = await asClient().from("support_tickets").update(patch).eq("id", ticketId);
  if (error) throw toSupportError(error, "support_ticket_update_failed");
}

export async function listAssignableSupportAgents(): Promise<Array<{ user_id: string; role: string }>> {
  const { data, error } = await asClient()
    .from("user_roles")
    .select("user_id,role")
    .in("role", ["admin", "editor"])
    .order("role", { ascending: true });

  if (error) throw toSupportError(error, "support_agents_load_failed");

  const rows = Array.isArray(data) ? data : [];
  return rows.map((row: any) => ({
    user_id: String(row.user_id),
    role: String(row.role),
  }));
}

export async function loadSupportAiConfig(): Promise<SupportAiConfig> {
  const { data, error } = await asClient()
    .from("support_ai_config")
    .select("id,config_key,openrouter_model,temperature,max_tokens,confidence_threshold,system_prompt_base,created_at,updated_at")
    .eq("config_key", "default")
    .single();

  if (error || !data) throw toSupportError(error, "support_ai_config_load_failed");
  return data as SupportAiConfig;
}

export async function updateSupportAiConfig(input: Partial<SupportAiConfig>): Promise<void> {
  const { error } = await asClient()
    .from("support_ai_config")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("config_key", "default");

  if (error) throw toSupportError(error, "support_ai_config_update_failed");
}

export async function countPendingSupportTickets(): Promise<number> {
  const { count, error } = await asClient()
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_human");

  if (error) throw toSupportError(error, "support_pending_count_failed");
  return Number(count || 0);
}
