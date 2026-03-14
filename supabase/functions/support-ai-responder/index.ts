import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildUserAgent } from "../_shared/brand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Role = "user" | "assistant";

type SupportConversationItem = {
  role: Role;
  content: string;
};

type SupportFaqCard = {
  id: string;
  category: string;
  question: string;
  answer_md: string;
  sort_order: number;
};

type SupportConfig = {
  openrouter_model: string;
  temperature: number;
  max_tokens: number;
  confidence_threshold: number;
  system_prompt_base: string;
};

type SupportRequest = {
  message?: string;
  conversation?: SupportConversationItem[];
  page_url?: string;
  ticket_id?: string;
  user_id?: string;
  anon_email?: string;
};

type SupportAction = "continue" | "create_ticket" | "ticket_created" | "faq_cards";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function mustEnv(name: string): string {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function trimTo(value: string, max = 500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function extractBearer(req: Request): string {
  const header = normalizeText(req.headers.get("Authorization") || req.headers.get("authorization"));
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function inferCategory(message: string, pageUrl: string): "bug" | "usage" | "billing" | "other" {
  const text = `${message} ${pageUrl}`.toLowerCase();
  if (/credit|billing|payment|stripe|subscription|plano|fatura|pack/.test(text)) return "billing";
  if (/bug|error|falha|crash|stack|500|404|exception/.test(text)) return "bug";
  if (/how|como|usar|tool|widget|thumb|generate|edit|camera|layer/.test(text)) return "usage";
  return "other";
}

function inferFaqCategoryFromPage(pageUrl: string): string | null {
  const p = pageUrl.toLowerCase();
  if (p.includes("billing") || p.includes("credit")) return "billing";
  if (p.includes("thumb") || p.includes("widget") || p.includes("tool")) return "usage";
  if (p.includes("admin")) return "bug";
  return null;
}

function renderFaqContext(faqs: SupportFaqCard[]): string {
  if (!faqs.length) return "No FAQ context found.";
  return faqs
    .slice(0, 3)
    .map((faq, index) => `FAQ ${index + 1}: [${faq.category}] Q: ${faq.question} A: ${faq.answer_md}`)
    .join("\n");
}

function renderRagContext(rows: any[]): string {
  if (!rows.length) return "No memory context found.";
  return rows
    .slice(0, 3)
    .map((row, index) => {
      const title = normalizeText((row as any).title || (row as any).label || `Document ${index + 1}`);
      const body = normalizeText((row as any).content || (row as any).content_md || (row as any).excerpt || "");
      return `${title}: ${trimTo(body, 800)}`;
    })
    .join("\n\n");
}

function normalizeConversation(raw: unknown): SupportConversationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const role = normalizeText((item as any)?.role).toLowerCase();
      const content = normalizeText((item as any)?.content);
      if (!content) return null;
      if (role !== "user" && role !== "assistant") return null;
      return { role: role as Role, content };
    })
    .filter((item): item is SupportConversationItem => Boolean(item))
    .slice(-16);
}

function findEscalationSignal(text: string): boolean {
  const value = text.toLowerCase();
  const patterns = [
    "i cannot",
    "i can't",
    "i do not know",
    "i don't know",
    "human support",
    "create a ticket",
    "abrir ticket",
    "abrir um ticket",
    "suporte humano",
    "nao consigo resolver",
  ];
  return patterns.some((pattern) => value.includes(pattern));
}

function detectIssueReport(message: string, conversation: SupportConversationItem[]): boolean {
  const full = extractAllUserText(message, conversation);
  const issuePatterns = [
    "erro",
    "error",
    "falha",
    "failed",
    "failure",
    "nao funciona",
    "nao processa",
    "problema",
    "bug",
    "crash",
    "timeout",
    "card_declined",
    "declined",
    "cobrado",
    "duplicado",
    "invoice",
    "fatura errada",
    "refund",
    "chargeback",
    "500",
    "404",
  ];
  return issuePatterns.some((p) => full.includes(p));
}

function isBillingInformationalQuery(message: string, conversation: SupportConversationItem[]): boolean {
  const full = extractAllUserText(message, conversation);
  const billingScope = /(credit|credito|billing|assinatura|subscription|wallet|pool|weekly|mensal|monthly|pack|pacote)/.test(full);
  const asksHow = /(como|how|funciona|works|entender|explain|explica|coloco|adicion|comprar|buy|renova|renew)/.test(full);
  const issue = detectIssueReport(message, conversation);
  return billingScope && asksHow && !issue;
}

function buildBillingGuidanceReply(message: string, isPt: boolean): string {
  const text = message.toLowerCase();
  const asksAddCredits = /(coloco|adicion|compr|buy|pack|pacote|creditos extras|extra credit)/.test(text);

  if (isPt) {
    if (asksAddCredits) {
      return [
        "Voce pode adicionar creditos extras em **/app/credits** na secao de pacotes.",
        "Para assinatura e plano, use **/app/billing**.",
        "",
        "Resumo rapido:",
        "- consumo usa **weekly wallet** primeiro;",
        "- depois usa **extra wallet**;",
        "- o **monthly pool** e contabil do ciclo e nao e gasto direto.",
      ].join("\n");
    }

    return [
      "No sistema de creditos do plano Pro:",
      "- **Monthly pool**: saldo total contabil do ciclo (ex.: 800).",
      "- **Weekly wallet**: parte liberada para uso na semana (ex.: 200).",
      "- **Extra wallet**: creditos comprados a parte.",
      "",
      "Ordem de consumo: **weekly wallet -> extra wallet**.",
      "Se a weekly zerar, aguarde a proxima liberacao semanal ou compre pacote extra em **/app/credits**.",
    ].join("\n");
  }

  if (asksAddCredits) {
    return [
      "You can add extra credits at **/app/credits** in the packs section.",
      "For subscription and plan management, use **/app/billing**.",
      "",
      "Quick summary:",
      "- usage spends **weekly wallet** first;",
      "- then spends **extra wallet**;",
      "- **monthly pool** is accounting cycle balance, not direct spend.",
    ].join("\n");
  }

  return [
    "In the Pro credits system:",
    "- **Monthly pool**: total accounting balance for the cycle (for example, 800).",
    "- **Weekly wallet**: the weekly released amount you can spend now (for example, 200).",
    "- **Extra wallet**: separately purchased credits.",
    "",
    "Spend order: **weekly wallet -> extra wallet**.",
    "If weekly reaches zero, wait for next weekly release or buy extra packs at **/app/credits**.",
  ].join("\n");
}

function findUserEscalationRequest(text: string): boolean {
  const value = text.toLowerCase();
  const patterns = [
    "human support",
    "support agent",
    "talk to human",
    "talk to an agent",
    "create a ticket",
    "open a ticket",
    "falar com humano",
    "falar com atendente",
    "suporte humano",
    "abrir ticket",
    "abrir um ticket",
    "escalar para humano",
  ];
  return patterns.some((pattern) => value.includes(pattern));
}

function isLikelyPortuguese(text: string): boolean {
  const value = text.toLowerCase();
  return /(nao|como|voce|voces|ajuda|pagamento|assinatura|erro|suporte|ticket|obrigado|oi|ola)\b/.test(value);
}

function extractAllUserText(message: string, conversation: SupportConversationItem[]): string {
  const timeline = [
    ...conversation.filter((item) => item.role === "user").map((item) => item.content),
    message,
  ];
  return normalizeText(timeline.join(" ")).toLowerCase();
}

function hasSufficientIssueDetail(message: string, conversation: SupportConversationItem[]): boolean {
  const full = extractAllUserText(message, conversation);
  const veryLongNarrative = full.length >= 220;
  const hasDiagnosticKeywords =
    /(erro|error|codigo|code|falha|failed|recusad|declin|charge|fatura|invoice|cartao|pix|bug|crash|stack|timeout|500|404)/.test(full);
  const hasSpecificSignals =
    /([0-9]{2,}|hora|date|data|id_|pi_|in_|cs_|txn|transacao|pagamento duplicado|cobrado duas vezes)/.test(full);
  return veryLongNarrative || (hasDiagnosticKeywords && hasSpecificSignals);
}

function needsClarificationBeforeTicket(
  category: "bug" | "usage" | "billing" | "other",
  message: string,
  conversation: SupportConversationItem[],
): boolean {
  const userTurns = conversation.filter((item) => item.role === "user").length + 1;
  if (hasSufficientIssueDetail(message, conversation)) return false;

  // Force one triage turn for short/ambiguous reports before creating a ticket.
  if (userTurns <= 2) return true;

  if (category === "billing") return true;
  return false;
}

function buildClarificationPrompt(
  category: "bug" | "usage" | "billing" | "other",
  isPt: boolean,
): string {
  if (isPt) {
    if (category === "billing") {
      return [
        "Consigo abrir o ticket para o time humano agora, mas antes preciso de 3 detalhes para agilizar:",
        "1) Qual erro apareceu (mensagem exata, se tiver).",
        "2) Data/hora aproximada da tentativa.",
        "3) Metodo usado (cartao, Pix, etc.) e, se cartao, apenas os 4 ultimos digitos.",
        "Nao envie numero completo de cartao.",
      ].join("\n");
    }
    return [
      "Posso abrir o ticket para o time humano agora.",
      "Antes disso, descreva em 2-3 linhas:",
      "1) o que voce esperava que acontecesse,",
      "2) o que aconteceu de fato,",
      "3) qualquer erro/codigo que apareceu.",
    ].join("\n");
  }

  if (category === "billing") {
    return [
      "I can open a human-support ticket now, but I need 3 details first:",
      "1) Exact error message (if any).",
      "2) Approximate date/time of the attempt.",
      "3) Payment method used (card, Pix, etc.) and if card, only the last 4 digits.",
      "Do not send full card numbers.",
    ].join("\n");
  }

  return [
    "I can open a human-support ticket now.",
    "Before that, please share in 2-3 lines:",
    "1) what you expected to happen,",
    "2) what happened instead,",
    "3) any visible error/code.",
  ].join("\n");
}

function buildTicketCreatedReply(args: {
  reply: string;
  ticketId: string;
  userId: string | null;
  anonEmail: string | null;
  isPt: boolean;
}): string {
  const { reply, ticketId, userId, anonEmail, isPt } = args;
  const code = ticketId.slice(0, 8).toUpperCase();

  if (isPt) {
    const followUp = userId
      ? `Ticket aberto com sucesso: #${code}.\nVoce pode acompanhar em /support?tab=tickets.`
      : `Ticket aberto com sucesso: #${code}.\nNosso time vai responder no e-mail ${anonEmail}.`;
    return `${reply}\n\n${followUp}`;
  }

  const followUp = userId
    ? `Ticket created successfully: #${code}.\nYou can track it at /support?tab=tickets.`
    : `Ticket created successfully: #${code}.\nOur team will reply to ${anonEmail}.`;
  return `${reply}\n\n${followUp}`;
}

function shouldEscalate(args: {
  reply: string;
  message: string;
  conversation: SupportConversationItem[];
  confidenceThreshold: number;
}): boolean {
  const { reply, message, conversation, confidenceThreshold } = args;
  const explicitEscalationRequest = findUserEscalationRequest(message);

  if (explicitEscalationRequest) return true;
  if (findEscalationSignal(reply) && detectIssueReport(message, conversation)) return true;

  if (!detectIssueReport(message, conversation)) return false;

  const userTurns = conversation.filter((item) => item.role === "user").length + 1;
  const normalizedThreshold = Math.min(1, Math.max(0, confidenceThreshold));

  // Higher threshold means more sensitive escalation. Lower threshold tolerates more turns.
  const unresolvedTurnsLimit = Math.max(2, Math.min(7, Math.round(7 - normalizedThreshold * 5)));
  return userTurns >= unresolvedTurnsLimit;
}

function buildSystemPrompt(basePrompt: string, pageUrl: string, faqContext: string, ragContext: string): string {
  return basePrompt
    .replaceAll("{page_url}", pageUrl || "unknown")
    .replaceAll("{faq_context}", faqContext)
    .replaceAll("{rag_context}", ragContext);
}

function getOpenRouterText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return normalizeText(content);
  if (Array.isArray(content)) {
    const text = content
      .map((part) => normalizeText((part as any)?.text || (part as any)?.content || ""))
      .filter(Boolean)
      .join("\n");
    return normalizeText(text);
  }
  return "";
}

function sanitizeForTitle(text: string): string {
  return trimTo(text.replace(/\s+/g, " ").trim(), 96);
}

async function resolveAuthedUser(req: Request) {
  const token = extractBearer(req);
  if (!token) return null;

  const authClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user?.id) return null;

  return {
    id: data.user.id,
    email: normalizeText(data.user.email || "") || null,
  };
}

async function loadConfig(service: ReturnType<typeof createClient>): Promise<SupportConfig> {
  const { data, error } = await service
    .from("support_ai_config")
    .select("openrouter_model,temperature,max_tokens,confidence_threshold,system_prompt_base")
    .eq("config_key", "default")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`load_config_failed:${error.message}`);

  return {
    openrouter_model: normalizeText(data?.openrouter_model || "openai/gpt-4o") || "openai/gpt-4o",
    temperature: Number(data?.temperature ?? 0.4),
    max_tokens: Number(data?.max_tokens ?? 1024),
    confidence_threshold: Number(data?.confidence_threshold ?? 0.6),
    system_prompt_base: normalizeText(data?.system_prompt_base || "You are UEFNToolkit support assistant."),
  };
}

async function loadPublishedFaqs(service: ReturnType<typeof createClient>): Promise<SupportFaqCard[]> {
  const { data, error } = await service
    .from("support_faqs")
    .select("id,category,question,answer_md,sort_order")
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .limit(200);

  if (error) throw new Error(`load_faqs_failed:${error.message}`);
  if (!Array.isArray(data)) return [];

  return data.map((row: any) => ({
    id: String(row.id),
    category: String(row.category || "other"),
    question: String(row.question || ""),
    answer_md: String(row.answer_md || ""),
    sort_order: Number(row.sort_order || 0),
  }));
}

function pickFaqCards(faqs: SupportFaqCard[], pageUrl: string): SupportFaqCard[] {
  const inferredCategory = inferFaqCategoryFromPage(pageUrl);
  const sorted = [...faqs].sort((a, b) => a.sort_order - b.sort_order);
  if (!inferredCategory) return sorted.slice(0, 4);

  const preferred = sorted.filter((faq) => faq.category === inferredCategory);
  const fallback = sorted.filter((faq) => faq.category !== inferredCategory);
  return [...preferred, ...fallback].slice(0, 4);
}

async function loadRagContext(service: ReturnType<typeof createClient>, message: string): Promise<any[]> {
  try {
    const { data, error } = await service.rpc("search_ralph_memory_documents", {
      p_query_text: message,
      p_query_embedding_text: message,
      p_scope: ["support"],
      p_match_count: 3,
      p_min_importance: 30,
    });

    if (error) {
      console.warn("[support-ai-responder] rag_error", error.message);
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("[support-ai-responder] rag_exception", error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function callOpenRouter(args: {
  cfg: SupportConfig;
  systemPrompt: string;
  conversation: SupportConversationItem[];
  message: string;
}) {
  const apiKey = String(Deno.env.get("OPENROUTER_API_KEY") || "").trim();
  if (!apiKey) throw new Error("missing_openrouter_key");

  const payload = {
    model: args.cfg.openrouter_model,
    temperature: args.cfg.temperature,
    max_tokens: args.cfg.max_tokens,
    messages: [
      { role: "system", content: args.systemPrompt },
      ...args.conversation.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: args.message },
    ],
  };

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://uefntoolkit.com",
      "X-Title": "UEFNToolkit Support",
      "User-Agent": buildUserAgent("support-ai-responder"),
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = null;
  }

  if (!resp.ok) {
    throw new Error(`openrouter_http_${resp.status}:${trimTo(text, 220)}`);
  }

  const reply = getOpenRouterText(parsed);
  if (!reply) throw new Error("openrouter_empty_reply");
  return reply;
}

async function ensureTicketAccess(service: ReturnType<typeof createClient>, ticketId: string, userId: string | null): Promise<boolean> {
  if (!ticketId) return false;

  const { data, error } = await service
    .from("support_tickets")
    .select("id,user_id")
    .eq("id", ticketId)
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) return false;
  if (!userId) return false;
  return String(data.user_id || "") === userId;
}

async function createTicketAndPersist(args: {
  service: ReturnType<typeof createClient>;
  userId: string | null;
  anonEmail: string | null;
  pageUrl: string;
  message: string;
  conversation: SupportConversationItem[];
  reply: string;
  category: "bug" | "usage" | "billing" | "other";
}) {
  const { service, userId, anonEmail, pageUrl, message, conversation, reply, category } = args;

  const titleSource =
    conversation.find((item) => item.role === "user" && item.content)?.content ||
    message;

  const { data: insertedTicket, error: ticketError } = await service
    .from("support_tickets")
    .insert({
      user_id: userId,
      anon_email: userId ? null : anonEmail,
      category,
      status: "pending_human",
      title: sanitizeForTitle(titleSource),
      page_url: pageUrl || null,
    })
    .select("id")
    .limit(1)
    .single();

  if (ticketError || !insertedTicket?.id) {
    throw new Error(`ticket_create_failed:${ticketError?.message || "unknown"}`);
  }

  const fullTimeline: SupportConversationItem[] = [
    ...conversation,
    { role: "user", content: message },
    { role: "assistant", content: reply },
  ];

  const messageRows = fullTimeline
    .map((item) => ({
      ticket_id: insertedTicket.id,
      author_id: item.role === "user" ? userId : null,
      body: item.content,
      is_ai: item.role === "assistant",
    }))
    .filter((row) => row.body);

  if (messageRows.length > 0) {
    const { error: messageError } = await service
      .from("support_messages")
      .insert(messageRows);

    if (messageError) {
      throw new Error(`ticket_messages_create_failed:${messageError.message}`);
    }
  }

  return insertedTicket.id as string;
}

async function appendMessageToTicket(args: {
  service: ReturnType<typeof createClient>;
  ticketId: string;
  userId: string | null;
  message: string;
  reply: string;
  escalate: boolean;
}) {
  const { service, ticketId, userId, message, reply, escalate } = args;

  const rows = [
    {
      ticket_id: ticketId,
      author_id: userId,
      body: message,
      is_ai: false,
    },
    {
      ticket_id: ticketId,
      author_id: null,
      body: reply,
      is_ai: true,
    },
  ];

  const { error: insertError } = await service.from("support_messages").insert(rows);
  if (insertError) throw new Error(`append_ticket_messages_failed:${insertError.message}`);

  const ticketPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (escalate) ticketPatch.status = "pending_human";

  const { error: updateError } = await service
    .from("support_tickets")
    .update(ticketPatch)
    .eq("id", ticketId);

  if (updateError) throw new Error(`append_ticket_update_failed:${updateError.message}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const service = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const body = (await req.json().catch(() => ({}))) as SupportRequest;
    const message = normalizeText(body.message);
    const conversation = normalizeConversation(body.conversation);
    const pageUrl = normalizeText(body.page_url || "") || "unknown";
    const requestedTicketId = normalizeText(body.ticket_id || "");
    const anonEmail = normalizeText(body.anon_email || "").toLowerCase();
    const isPt = isLikelyPortuguese(`${message} ${conversation.map((item) => item.content).join(" ")}`);

    if (!message) return json({ error: "missing_message" }, 400);

    const authedUser = await resolveAuthedUser(req);
    const userId = authedUser?.id || null;

    const cfg = await loadConfig(service);
    const faqs = await loadPublishedFaqs(service);
    const faqCards = pickFaqCards(faqs, pageUrl).map((faq) => ({
      id: faq.id,
      question: faq.question,
      answer_md: faq.answer_md,
      category: faq.category,
    }));

    const ragRows = await loadRagContext(service, message);
    const faqContext = renderFaqContext(faqCards as any);
    const ragContext = renderRagContext(ragRows);

    const systemPrompt = buildSystemPrompt(cfg.system_prompt_base, pageUrl, faqContext, ragContext);
    let reply: string;
    let openRouterFailed = false;
    try {
      reply = await callOpenRouter({ cfg, systemPrompt, conversation, message });
    } catch (error) {
      console.error("[support-ai-responder] openrouter_failed", error instanceof Error ? error.message : String(error));
      openRouterFailed = true;
      reply = isPt
        ? "Nao foi possivel processar sua mensagem agora. Tente novamente em instantes."
        : "I could not process your message right now. Please try again in a moment.";
    }

    if (openRouterFailed) {
      return json({
        reply,
        action: conversation.length === 0 ? "faq_cards" : "continue",
        faq_cards: conversation.length === 0 ? faqCards : undefined,
      });
    }

    const escalate = shouldEscalate({
      reply,
      message,
      conversation,
      confidenceThreshold: cfg.confidence_threshold,
    });
    const category = inferCategory(message, pageUrl);
    const billingInfoQuery = isBillingInformationalQuery(message, conversation);

    if (billingInfoQuery) {
      return json({
        reply: buildBillingGuidanceReply(message, isPt),
        action: conversation.length === 0 ? "faq_cards" : "continue",
        faq_cards: conversation.length === 0 ? faqCards : undefined,
      });
    }

    if (escalate && needsClarificationBeforeTicket(category, message, conversation)) {
      return json({
        reply: buildClarificationPrompt(category, isPt),
        action: "continue" as SupportAction,
        faq_cards: conversation.length === 0 ? faqCards : undefined,
      });
    }

    const canUseTicketId = requestedTicketId
      ? await ensureTicketAccess(service, requestedTicketId, userId)
      : false;

    if (escalate && !userId && !isValidEmail(anonEmail)) {
      const askEmailReply = isPt
        ? `${reply}\n\nPara eu abrir seu ticket com o time humano, me envie um e-mail valido para contato.`
        : `${reply}\n\nTo open a ticket with the human support team, please share a valid contact email.`;
      return json({
        reply: askEmailReply,
        action: "create_ticket" as SupportAction,
        faq_cards: conversation.length === 0 ? faqCards : undefined,
      });
    }

    if (canUseTicketId) {
      await appendMessageToTicket({
        service,
        ticketId: requestedTicketId,
        userId,
        message,
        reply,
        escalate,
      });
      const finalReply = escalate
        ? buildTicketCreatedReply({
          reply,
          ticketId: requestedTicketId,
          userId,
          anonEmail: userId ? null : anonEmail,
          isPt,
        })
        : reply;

      return json({
        reply: finalReply,
        action: escalate ? "ticket_created" : "continue",
        ticket_id: requestedTicketId,
        faq_cards: conversation.length === 0 ? faqCards : undefined,
      });
    }

    if (escalate) {
      const ticketId = await createTicketAndPersist({
        service,
        userId,
        anonEmail: userId ? null : anonEmail,
        pageUrl,
        message,
        conversation,
        reply,
        category,
      });
      const finalReply = buildTicketCreatedReply({
        reply,
        ticketId,
        userId,
        anonEmail: userId ? null : anonEmail,
        isPt,
      });

      return json({
        reply: finalReply,
        action: "ticket_created" as SupportAction,
        ticket_id: ticketId,
        faq_cards: conversation.length === 0 ? faqCards : undefined,
      });
    }

    return json({
      reply,
      action: conversation.length === 0 ? "faq_cards" : "continue",
      faq_cards: conversation.length === 0 ? faqCards : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[support-ai-responder] fatal", message);
    return json({ error: "internal_error" }, 500);
  }
});
