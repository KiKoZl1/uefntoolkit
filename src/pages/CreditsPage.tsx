import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Wallet } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  createPackCheckout,
  getCommerceCredits,
  getCommerceLedger,
  listCreditPacks,
} from "@/lib/commerce/client";

type Pack = { pack_code: "pack_250" | "pack_650" | "pack_1400"; credits: number };

type LedgerItem = {
  id: number;
  entry_type: string;
  wallet_type: string;
  tool_code?: string | null;
  delta: number;
  created_at: string;
};

const PACK_LABELS: Record<Pack["pack_code"], string> = {
  pack_250: "Pack Starter",
  pack_650: "Pack Creator",
  pack_1400: "Pack Pro",
};

const TOOL_LABELS: Record<string, string> = {
  surprise_gen: "Surprise Gen",
  edit_studio: "Surprise Rewrite",
  camera_control: "Surprise Vision",
  layer_decomposition: "Surprise Intent",
  psd_to_umg: "PSD para UMG",
  umg_to_verse: "UMG para Verse",
};

const WALLET_LABELS: Record<string, string> = {
  weekly_wallet: "Carteira semanal",
  monthly_plan: "Pool mensal",
  extra_wallet: "Carteira extra",
  free_monthly: "Creditos de boas-vindas",
};

const ENTRY_TYPE_LABELS: Record<string, string> = {
  cycle_base_grant: "Credito base do ciclo",
  cycle_rollover_grant: "Credito de rollover",
  weekly_release_grant: "Liberacao semanal",
  tool_usage_debit: "Uso de ferramenta",
  pack_purchase_grant: "Compra de pacote extra",
  admin_manual_grant: "Ajuste manual de credito",
  admin_manual_debit: "Ajuste manual de debito",
  refund_credit: "Reembolso de credito",
  reversal_credit: "Estorno de execucao",
  expiration_debit: "Expiracao de credito",
  free_monthly_grant: "Credito de boas-vindas",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function getEntryTitle(item: LedgerItem): string {
  if (item.entry_type === "tool_usage_debit" && item.tool_code) {
    return `Uso: ${TOOL_LABELS[item.tool_code] || item.tool_code}`;
  }
  return ENTRY_TYPE_LABELS[item.entry_type] || "Movimento de credito";
}

function getWalletLabel(walletType: string): string {
  return WALLET_LABELS[walletType] || "Carteira";
}

export default function CreditsPage() {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<string>("");
  const [credits, setCredits] = useState<any>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);

  async function loadLedger() {
    setLedgerLoading(true);
    try {
      const ledgerRes = await getCommerceLedger(12);
      setLedger(Array.isArray(ledgerRes?.items) ? ledgerRes.items : []);
    } catch {
      setLedger([]);
    } finally {
      setLedgerLoading(false);
    }
  }

  async function load(forceRefresh = false) {
    setLoading(true);
    try {
      const [creditRes, packRes] = await Promise.all([
        getCommerceCredits({ forceRefresh }),
        listCreditPacks(),
      ]);
      setCredits(creditRes);
      setPacks(Array.isArray(packRes?.packs) ? packRes.packs : []);
      void loadLedger();
    } catch (error) {
      toast({
        title: "Erro",
        description: String((error as Error)?.message || "Falha ao carregar creditos."),
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
    const pack = params.get("pack");
    if (!pack) return;

    if (pack === "success") {
      toast({
        title: "Pagamento confirmado",
        description: "Seus creditos extras foram atualizados.",
      });
      void load(true);
    } else {
      toast({
        title: "Checkout cancelado",
        description: "A compra do pacote nao foi concluida.",
        variant: "destructive",
      });
    }

    params.delete("pack");
    navigate({ pathname: "/app/credits", search: params.toString() ? `?${params.toString()}` : "" }, { replace: true });
  }, [location.search, navigate, toast]);

  async function startPackCheckout(packCode: Pack["pack_code"]) {
    setCheckingOut(packCode);
    try {
      const data = await createPackCheckout(packCode, {
        successUrl: `${window.location.origin}/app/credits?pack=success`,
        cancelUrl: `${window.location.origin}/app/credits?pack=cancel`,
      });
      const checkoutUrl = String(data?.checkout_url || "");
      if (!checkoutUrl) throw new Error("checkout_url_missing");
      window.location.href = checkoutUrl;
    } catch (error) {
      toast({
        title: "Erro",
        description: String((error as Error)?.message || "Falha ao iniciar checkout do pacote."),
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
          Carregando creditos...
        </div>
      </div>
    );
  }

  const wallet = credits?.wallet || {};
  const spendableNow = Number(
    credits?.summary?.spendable_now ??
      (Number(wallet.weekly_wallet || 0) + Number(wallet.free_monthly_remaining || 0) + Number(wallet.extra_wallet || 0)),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <Button variant="ghost" size="sm" asChild className="w-fit">
          <Link to="/app/billing">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para Assinatura
          </Link>
        </Button>
        <h1 className="font-display text-3xl font-bold">Creditos e Pacotes</h1>
        <p className="text-sm text-muted-foreground">Saldo atual, compra de pacotes extras e historico detalhado de uso.</p>
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
            <CardTitle className="text-base">Pool mensal</CardTitle>
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

      <Card id="credit-packs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="h-5 w-5" />
            Pacotes de Creditos Extras
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {packs.map((pack) => (
            <div key={pack.pack_code} className="rounded-lg border border-border/70 p-4">
              <p className="text-sm text-muted-foreground">{PACK_LABELS[pack.pack_code]}</p>
              <p className="mt-1 text-2xl font-bold">{pack.credits} creditos</p>
              <Button
                className="mt-3 w-full"
                variant="outline"
                onClick={() => void startPackCheckout(pack.pack_code)}
                disabled={checkingOut === pack.pack_code}
              >
                {checkingOut === pack.pack_code ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Comprar
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Historico Recente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ledgerLoading ? (
            <p className="text-sm text-muted-foreground">Carregando historico...</p>
          ) : ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum movimento recente.</p>
          ) : (
            ledger.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{getEntryTitle(item)}</p>
                  <p className="text-xs text-muted-foreground">{getWalletLabel(item.wallet_type)}</p>
                </div>
                <div className="text-right">
                  <p className={item.delta < 0 ? "font-semibold text-destructive" : "font-semibold text-emerald-600"}>
                    {item.delta > 0 ? `+${item.delta}` : item.delta}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(item.created_at)}</p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
