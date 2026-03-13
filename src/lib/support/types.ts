export type SupportCategory = "bug" | "usage" | "billing" | "other";

export type SupportTicketStatus = "open" | "ai_resolved" | "pending_human" | "resolved";

export type SupportChatRole = "user" | "assistant";

export interface SupportFaq {
  id: string;
  category: SupportCategory;
  question: string;
  answer_md: string;
  published?: boolean;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface SupportTicket {
  id: string;
  user_id: string | null;
  anon_email: string | null;
  category: SupportCategory;
  status: SupportTicketStatus;
  title: string;
  page_url: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  author_id: string | null;
  body: string;
  is_ai: boolean;
  created_at: string;
}

export interface SupportAiConfig {
  id: string;
  config_key: string;
  openrouter_model: string;
  temperature: number;
  max_tokens: number;
  confidence_threshold: number;
  system_prompt_base: string;
  created_at: string;
  updated_at: string;
}

export interface SupportResponderConversationItem {
  role: SupportChatRole;
  content: string;
}

export interface SupportResponderRequest {
  message: string;
  conversation: SupportResponderConversationItem[];
  page_url?: string;
  ticket_id?: string;
  user_id?: string;
  anon_email?: string;
}

export interface SupportResponderResponse {
  reply: string;
  action: "continue" | "create_ticket" | "ticket_created" | "faq_cards";
  faq_cards?: Array<Pick<SupportFaq, "id" | "question" | "answer_md" | "category">>;
  ticket_id?: string;
}

export const SUPPORT_STATUS_OPTIONS: SupportTicketStatus[] = ["open", "pending_human", "resolved", "ai_resolved"];
export const SUPPORT_CATEGORY_OPTIONS: SupportCategory[] = ["bug", "usage", "billing", "other"];
