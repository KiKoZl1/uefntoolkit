import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { Loader2, Send, TicketCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSupportChat } from "@/components/support/useSupportChat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SupportFaqCard } from "@/components/support/SupportFaqCard";

interface SupportChatProps {
  mode?: "widget" | "page";
  allowAnonymous?: boolean;
  className?: string;
}

export function SupportChat({ mode = "widget", allowAnonymous = false, className }: SupportChatProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const {
    canChat,
    isLoading,
    messages,
    faqCards,
    ticketId,
    ticketCreated,
    error,
    sendMessage,
    useFaqQuestion,
  } = useSupportChat({ allowAnonymous });

  const wrapperClass = useMemo(() => {
    if (mode === "page") return "w-full max-w-3xl rounded-xl border border-border/70 bg-card/40";
    return "w-full rounded-xl border border-border/70 bg-card/40 h-full min-h-0";
  }, [mode]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  async function onSubmit() {
    const text = value.trim();
    if (!text || isLoading) return;
    setValue("");
    await sendMessage(text);
  }

  if (!canChat) {
    return (
      <div className={cn(wrapperClass, "p-4", className)}>
        <p className="text-sm text-muted-foreground">{t("support.chat.signInRequired")}</p>
      </div>
    );
  }

  return (
    <div className={cn(wrapperClass, "flex h-full flex-col", mode === "page" ? "min-h-[520px]" : "min-h-0", className)}>
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{t("support.chat.title")}</p>
            <p className="text-xs text-muted-foreground">{t("support.chat.subtitle")}</p>
          </div>
          {ticketCreated && ticketId ? (
            <Badge variant="outline" className="gap-1 text-[10px] uppercase tracking-[0.1em] text-emerald-400">
              <TicketCheck className="h-3.5 w-3.5" />
              {t("support.chat.ticketCreated", { id: ticketId.slice(0, 8) })}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <div
                key={message.id}
                className={cn("flex", isUser ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                    isUser
                      ? "bg-primary/15 text-foreground border border-primary/25"
                      : "bg-muted/40 text-foreground border border-border/70",
                  )}
                >
                  <div className="prose prose-sm max-w-none prose-p:my-2 prose-li:my-1 prose-strong:text-foreground/95 prose-headings:text-foreground/95">
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            );
          })}

          {isLoading ? (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("support.chat.typing")}
              </div>
            </div>
          ) : null}

          {faqCards.length > 0 ? (
            <div className="space-y-2 pt-1">
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{t("support.chat.faqSuggestions")}</p>
              <div className="space-y-2">
                {faqCards.map((faq) => (
                  <SupportFaqCard
                    key={faq.id}
                    faq={faq}
                    onNotHelpful={(question) => {
                      void useFaqQuestion(question);
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border/70 px-4 py-3">
        {error ? (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t("support.chat.inputPlaceholder")}
            className="min-h-[88px] resize-none"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void onSubmit();
              }
            }}
          />

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void onSubmit()}
              disabled={isLoading || value.trim().length === 0}
              className="gap-2"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("support.chat.send")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
