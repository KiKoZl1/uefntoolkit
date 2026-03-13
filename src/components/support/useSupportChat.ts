import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { listPublishedSupportFaqs, invokeSupportAiResponder } from "@/lib/support/client";
import { SupportFaq, SupportResponderConversationItem } from "@/lib/support/types";

export interface SupportChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface UseSupportChatOptions {
  allowAnonymous?: boolean;
}

const GREETING_ID = "support-greeting";
const TICKET_STORAGE_PREFIX = "support_chat_ticket_v1:";
const ANON_EMAIL_STORAGE_KEY = "support_chat_anon_email_v1";
const PENDING_TICKET_STORAGE_KEY = "support_chat_pending_ticket_v1";

const GREETING_MESSAGE = "Oi! Sou o assistente de suporte da UEFNToolkit. Como posso te ajudar hoje?";

function nowIso() {
  return new Date().toISOString();
}

function createMessage(role: "user" | "assistant", content: string): SupportChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: nowIso(),
  };
}

function isValidEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function readStorage(key: string): string {
  if (typeof window === "undefined") return "";
  return String(window.localStorage.getItem(key) || "").trim();
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  if (!value) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, value);
}

function ticketStorageKey(userId: string | null | undefined) {
  return `${TICKET_STORAGE_PREFIX}${userId || "anon"}`;
}

export function useSupportChat(options?: UseSupportChatOptions) {
  const { user } = useAuth();
  const allowAnonymous = Boolean(options?.allowAnonymous);
  const [messages, setMessages] = useState<SupportChatMessage[]>([]);
  const [faqCards, setFaqCards] = useState<Array<Pick<SupportFaq, "id" | "question" | "answer_md" | "category">>>([]);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketCreated, setTicketCreated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBooted, setIsBooted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anonEmailRef = useRef<string>("");

  const canChat = Boolean(user) || allowAnonymous;

  const boot = useCallback(async () => {
    if (isBooted || !canChat) return;

    const storedTicketId = readStorage(ticketStorageKey(user?.id));
    if (storedTicketId) setTicketId(storedTicketId);

    if (!user) {
      anonEmailRef.current = readStorage(ANON_EMAIL_STORAGE_KEY);
    }

    setMessages([
      {
        id: GREETING_ID,
        role: "assistant",
        content: GREETING_MESSAGE,
        createdAt: nowIso(),
      },
    ]);

    try {
      const faqs = await listPublishedSupportFaqs(4);
      setFaqCards(faqs.map((faq) => ({
        id: faq.id,
        category: faq.category,
        question: faq.question,
        answer_md: faq.answer_md,
      })));
    } catch {
      setFaqCards([]);
    }

    setIsBooted(true);
  }, [canChat, isBooted, user]);

  useEffect(() => {
    if (!canChat) return;
    void boot();
  }, [boot, canChat]);

  const conversationForApi = useMemo<SupportResponderConversationItem[]>(() => {
    return messages
      .filter((message) => message.id !== GREETING_ID)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }))
      .slice(-16);
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    const content = String(text || "").trim();
    if (!content || isLoading || !canChat) return;

    if (!user && isValidEmail(content)) {
      anonEmailRef.current = content.toLowerCase();
      writeStorage(ANON_EMAIL_STORAGE_KEY, anonEmailRef.current);
    }

    const userMessage = createMessage("user", content);
    setMessages((prev) => [...prev, userMessage]);
    setError(null);
    setIsLoading(true);

    try {
      const response = await invokeSupportAiResponder({
        message: content,
        conversation: conversationForApi,
        page_url: typeof window !== "undefined" ? window.location.pathname + window.location.search : undefined,
        ticket_id: ticketId || undefined,
        user_id: user?.id,
        anon_email: anonEmailRef.current || undefined,
      });

      const assistantReply = String(response.reply || "").trim() || "Nao consegui responder agora. Tente novamente.";
      setMessages((prev) => [...prev, createMessage("assistant", assistantReply)]);

      if (Array.isArray(response.faq_cards) && response.faq_cards.length > 0) {
        setFaqCards(response.faq_cards);
      }

      if (response.ticket_id) {
        setTicketId(response.ticket_id);
        setTicketCreated(true);
        writeStorage(ticketStorageKey(user?.id), response.ticket_id);
        writeStorage(PENDING_TICKET_STORAGE_KEY, response.ticket_id);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Erro inesperado no suporte.");
      setMessages((prev) => [
        ...prev,
        createMessage(
          "assistant",
          "Nao foi possivel processar sua mensagem agora. Tente novamente em instantes.",
        ),
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [canChat, conversationForApi, isLoading, ticketId, user?.id, user]);

  const useFaqQuestion = useCallback(async (question: string) => {
    await sendMessage(question);
  }, [sendMessage]);

  const resetConversation = useCallback(() => {
    setMessages([
      {
        id: GREETING_ID,
        role: "assistant",
        content: GREETING_MESSAGE,
        createdAt: nowIso(),
      },
    ]);
    setTicketCreated(false);
    setError(null);
  }, []);

  return {
    canChat,
    isBooted,
    isLoading,
    messages,
    faqCards,
    ticketId,
    ticketCreated,
    error,
    boot,
    sendMessage,
    useFaqQuestion,
    resetConversation,
  };
}
