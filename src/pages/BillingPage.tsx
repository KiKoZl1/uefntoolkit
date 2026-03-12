import { useEffect, useState } from "react";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  createSubscriptionCheckout,
  getCommerceCredits,
} from "@/lib/commerce/client";

type CreditsPayload = {
  account?: { plan_type?: string; access_state?: string };
  wallet?: {
    weekly_wallet?: number;
    monthly_plan_remaining?: number;
    extra_wallet?: number;
    free_monthly_remaining?: number;
  };
  cycle?: {
    cycle_start?: string;
    cycle_end?: string;
    weekly_target?: number;
    monthly_plan_credits?: number;
    rollover_credits?: number;
  };
  subscription?: {
    status?: string;
    current_period_start?: string | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
  } | null;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatSubscriptionStatus(value: string): string {
  const status = String(value || "").toLowerCase();
  if (status === "active") return "Ativa";
  if (status === "past_due") return "Pagamento pendente";
  if (status === "cancel_at_period_end") return "Cancelamento ao fim do ciclo";
  if (status === "canceled") return "Cancelada";
  if (status === "expired") return "Expirada";
  return "Inativa";
}

function computeNextWeeklyUnlock(cycle: CreditsPayload["cycle"]): string | null {
  if (!cycle?.cycle_start || !cycle?.cycle_end) return null;
  const start = new Date(cycle.cycle_start).getTime();
  const end = new Date(cycle.cycle_end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  if (now >= end) return cycle.cycle_end;
  const elapsed = Math.max(0, now - start);
  const next = start + (Math.floor(elapsed / weekMs) + 1) * weekMs;
  return new Date(Math.min(next, end)).toISOString();
}

export default function BillingPage() {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<string>("");
  const [credits, setCredits] = useState<CreditsPayload | null>(null);

  async function load(forceRefresh = false) {
    setLoading(true);
    try {
      const creditRes = await getCommerceCredits({ forceRefresh });
      setCredits(creditRes);
    } catch (error) {
      toast({
        title: "Erro",
        description: String((error as Error)?.message || "Falha ao carregar billing."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const checkout = params.get("checkout");
    if (!checkout) return;

    if (checkout === "success") {
      toast({
        title: "Pagamento confirmado",
        description: "Seu plano foi atualizado. Atualizando saldos...",
      });
      void load(true);
    } else {
      toast({
        title: "Checkout cancelado",
        description: "O pagamento nao foi concluido.",
        variant: "destructive",
      });
    }

    params.delete("checkout");
    navigate({ pathname: "/app/billing", search: params.toString() ? `?${params.toString()}` : "" }, { replace: true });
  }, [location.search, navigate, toast]);

  async function startSubscriptionCheckout() {
    setCheckingOut("subscription");
    try {
      const data = await createSubscriptionCheckout({
        successUrl: `${window.location.origin}/app/billing?checkout=success`,
        cancelUrl: `${window.location.origin}/app/billing?checkout=cancel`,
      });
      const checkoutUrl = String(data?.checkout_url || "");
      if (!checkoutUrl) throw new Error("checkout_url_missing");
      window.location.href = checkoutUrl;
    } catch (error) {
      toast({
        title: "Erro",
        description: String((error as Error)?.message || "Falha ao iniciar checkout."),
        variant: "destructive",
      });
    } finally {
      setCheckingOut("");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando billing...
        </div>
      </div>
    );
  }

  const wallet = credits?.wallet || {};
  const account = credits?.account || {};
  const cycle = credits?.cycle || {};
  const subscription = credits?.subscription || null;
  const isPro = String(account.plan_type || "free") === "pro";
  const spendableNow = Number(wallet.weekly_wallet || 0) + Number(wallet.free_monthly_remaining || 0) + Number(wallet.extra_wallet || 0);
  const nextWeeklyUnlock = computeNextWeeklyUnlock(cycle);
  const renewalDate = subscription?.current_period_end || cycle?.cycle_end || null;
  const subscriptionStatus = formatSubscriptionStatus(String(subscription?.status || (isPro ? "active" : "inactive")));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-bold">Assinatura e Plano</h1>
        <p className="text-sm text-muted-foreground">Status da assinatura, renovacao e saldos do ciclo atual.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Disponivel agora</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{spendableNow}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Carteira semanal</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{Number(wallet.weekly_wallet || 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pool Mensal</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{Number(wallet.monthly_plan_remaining || 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Carteira extra</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{Number(wallet.extra_wallet || 0)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CreditCard className="h-5 w-5" />
            Assinatura
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Plano atual: <span className="font-semibold uppercase">{String(account.plan_type || "free")}</span>
          </p>
          <p className="text-sm text-muted-foreground">Status: {subscriptionStatus}</p>
          <p className="text-sm text-muted-foreground">Proxima renovacao: {formatDate(renewalDate)}</p>
          <p className="text-sm text-muted-foreground">Proxima liberacao semanal: {formatDate(nextWeeklyUnlock)}</p>
          <p className="text-sm text-muted-foreground">Rollover no ciclo: {Number(cycle?.rollover_credits || 0)} creditos</p>

          {!isPro ? (
            <Button onClick={startSubscriptionCheckout} disabled={checkingOut === "subscription"}>
              {checkingOut === "subscription" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Assinar Plano Pro
            </Button>
          ) : (
            <p className="text-sm text-emerald-600">Plano Pro ativo.</p>
          )}
          <div className="pt-2">
            <Button asChild variant="outline">
              <Link to="/app/credits">
                Ver pagina de Creditos e Pacotes
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
