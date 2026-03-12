import { FormEvent, useMemo, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Loader2, Search, ShieldAlert, User, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  adminDebitCredits,
  adminFindCommerceUserByEmail,
  adminGetCommerceUser,
  adminGrantCredits,
  adminSetAbuseReview,
  adminSetSuspension,
} from "@/lib/commerce/client";

type WalletType = "extra_wallet" | "weekly_wallet" | "free_monthly";

type AdminCommerceResponse = {
  user?: {
    id?: string;
    email?: string | null;
    created_at?: string | null;
    last_sign_in_at?: string | null;
    email_confirmed_at?: string | null;
    role?: string | null;
  } | null;
  account?: {
    plan_type?: string | null;
    access_state?: string | null;
    anti_abuse_review_required?: boolean;
    anti_abuse_reason?: string | null;
    free_eligible?: boolean;
  } | null;
  wallet?: {
    weekly_wallet?: number;
    free_monthly_remaining?: number;
    monthly_plan_remaining?: number;
    extra_wallet?: number;
  } | null;
  summary?: {
    spendable_now?: number;
    weekly_wallet_available?: number;
    free_monthly_available?: number;
    extra_wallet_available?: number;
    monthly_plan_remaining?: number;
  } | null;
  subscription?: {
    status?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
    provider?: string | null;
  } | null;
  ledger?: Array<{
    id: number;
    entry_type?: string | null;
    wallet_type?: string | null;
    tool_code?: string | null;
    delta?: number;
    reason?: string | null;
    actor_user_id?: string | null;
    actor_role?: string | null;
    actor_display_name?: string | null;
    actor_email?: string | null;
    created_at?: string | null;
  }>;
  attempts?: Array<{
    id: number;
    tool_code?: string | null;
    status?: string | null;
    credits_required?: number;
    error_code?: string | null;
    upstream_status?: number | null;
    created_at?: string | null;
  }>;
  abuse_signals?: Array<{
    id: number;
    signal_type?: string | null;
    signal_value?: string | null;
    state?: string | null;
    note?: string | null;
    created_at?: string | null;
  }>;
};

const TOOL_LABELS: Record<string, string> = {
  surprise_gen: "Surprise Gen",
  edit_studio: "Surprise Rewrite",
  camera_control: "Surprise Vision",
  layer_decomposition: "Surprise Intent",
  psd_to_umg: "PSD para UMG",
  umg_to_verse: "UMG para Verse",
};

const ENTRY_TYPE_LABELS: Record<string, string> = {
  cycle_base_grant: "Grant base de ciclo",
  cycle_rollover_grant: "Grant rollover",
  weekly_release_grant: "Liberacao semanal",
  tool_usage_debit: "Consumo de ferramenta",
  pack_purchase_grant: "Compra de pack",
  admin_manual_grant: "Ajuste manual (credito)",
  admin_manual_debit: "Ajuste manual (debito)",
  refund_credit: "Refund",
  reversal_credit: "Reversal",
  expiration_debit: "Expiracao",
  free_monthly_grant: "Grant free onboarding",
};

const WALLET_LABELS: Record<string, string> = {
  weekly_wallet: "Weekly",
  monthly_plan: "Monthly pool",
  extra_wallet: "Extra",
  free_monthly: "Free onboarding",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR");
}

function formatDelta(value: number | null | undefined): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return n > 0 ? `+${Math.floor(n)}` : String(Math.floor(n));
}

function formatAccessState(value: string | null | undefined): string {
  const raw = String(value || "").toLowerCase();
  if (!raw) return "-";
  if (raw === "free_active") return "Free ativo";
  if (raw === "pro_active") return "Pro ativo";
  if (raw === "pro_past_due") return "Pro pendente";
  if (raw === "pro_cancel_at_period_end") return "Pro cancelando no fim";
  if (raw === "pro_expired") return "Pro expirado";
  if (raw === "suspended") return "Suspenso";
  if (raw === "blocked_abuse_review") return "Bloqueado (review abuso)";
  if (raw === "blocked_insufficient_credits") return "Bloqueado (sem creditos)";
  if (raw === "allowed") return "Liberado";
  return raw;
}

function formatSubscriptionStatus(value: string | null | undefined): string {
  const status = String(value || "").toLowerCase();
  if (!status) return "-";
  if (status === "active") return "Ativa";
  if (status === "past_due") return "Past due";
  if (status === "cancel_at_period_end") return "Cancelamento ao fim do ciclo";
  if (status === "expired") return "Expirada";
  if (status === "canceled") return "Cancelada";
  return status;
}

function formatActorLabel(entry: {
  actor_display_name?: string | null;
  actor_email?: string | null;
  actor_user_id?: string | null;
  actor_role?: string | null;
}): string {
  const name = String(entry.actor_display_name || "").trim();
  const email = String(entry.actor_email || "").trim();
  const userId = String(entry.actor_user_id || "").trim();
  const role = String(entry.actor_role || "").trim().toLowerCase();
  const roleLabel = role === "admin" ? "admin" : role === "editor" ? "editor" : role || "sistema";

  if (name && email) return `${name} (${email}) [${roleLabel}]`;
  if (name) return `${name} [${roleLabel}]`;
  if (email) return `${email} [${roleLabel}]`;
  if (userId) return `${userId} [${roleLabel}]`;
  return "sistema";
}

export default function AdminCommerce() {
  const { toast } = useToast();
  const [loadingUser, setLoadingUser] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [searchEmail, setSearchEmail] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [walletType, setWalletType] = useState<WalletType>("extra_wallet");
  const [credits, setCredits] = useState(100);
  const [reason, setReason] = useState("");
  const [data, setData] = useState<AdminCommerceResponse | null>(null);

  const spendableNow = useMemo(() => {
    const fromSummary = Number(data?.summary?.spendable_now ?? NaN);
    if (Number.isFinite(fromSummary)) return fromSummary;
    const wallet = data?.wallet || {};
    return Number(wallet.weekly_wallet || 0) + Number(wallet.free_monthly_remaining || 0) + Number(wallet.extra_wallet || 0);
  }, [data?.summary?.spendable_now, data?.wallet]);
  const weeklyNow = Number(data?.wallet?.weekly_wallet || 0);
  const freeOnboardingNow = Number(data?.wallet?.free_monthly_remaining || 0);
  const extraNow = Number(data?.wallet?.extra_wallet || 0);
  const monthlyPoolNow = Number(data?.wallet?.monthly_plan_remaining || 0);

  const selectedUserId = String(data?.user?.id || targetUserId || "").trim();

  function showError(message: string) {
    toast({ title: "Erro", description: message, variant: "destructive" });
  }

  async function loadUserById(userIdRaw: string) {
    const userId = String(userIdRaw || "").trim();
    if (!userId) {
      showError("Informe um user_id para carregar.");
      return;
    }

    setLoadingUser(true);
    try {
      const res = await adminGetCommerceUser(userId);
      setData(res);
      setTargetUserId(String(res?.user?.id || userId));
      if (res?.user?.email) setSearchEmail(String(res.user.email));
    } catch (error) {
      showError(String((error as Error)?.message || "Falha ao carregar usuario."));
    } finally {
      setLoadingUser(false);
    }
  }

  async function lookupByEmail() {
    const normalizedEmail = String(searchEmail || "").trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      showError("Informe um email valido.");
      return;
    }

    setLoadingUser(true);
    try {
      const found = await adminFindCommerceUserByEmail(normalizedEmail);
      const userId = String(found?.user_id || "").trim();
      if (!userId) {
        showError("Usuario nao encontrado para esse email.");
        return;
      }
      setTargetUserId(userId);
      const res = await adminGetCommerceUser(userId);
      setData(res);
    } catch (error) {
      showError(String((error as Error)?.message || "Falha ao buscar usuario por email."));
    } finally {
      setLoadingUser(false);
    }
  }

  async function runCreditAdjust(mode: "grant" | "debit") {
    if (!selectedUserId) {
      showError("Carregue um usuario antes de ajustar creditos.");
      return;
    }
    if (!reason.trim()) {
      showError("Motivo obrigatorio para ajuste manual.");
      return;
    }

    setLoadingAction(true);
    try {
      if (mode === "grant") {
        await adminGrantCredits({
          userId: selectedUserId,
          walletType,
          credits: Math.max(1, Math.floor(credits)),
          reason: reason.trim(),
        });
      } else {
        await adminDebitCredits({
          userId: selectedUserId,
          walletType,
          credits: Math.max(1, Math.floor(credits)),
          reason: reason.trim(),
        });
      }
      await loadUserById(selectedUserId);
      toast({ title: mode === "grant" ? "Credito aplicado" : "Debito aplicado" });
    } catch (error) {
      showError(String((error as Error)?.message || "Falha no ajuste manual."));
    } finally {
      setLoadingAction(false);
    }
  }

  async function setReview(action: "approve" | "review" | "block") {
    if (!selectedUserId) {
      showError("Carregue um usuario antes de alterar antiabuso.");
      return;
    }

    setLoadingAction(true);
    try {
      await adminSetAbuseReview({
        userId: selectedUserId,
        action,
        reason: reason.trim() || undefined,
      });
      await loadUserById(selectedUserId);
      toast({ title: `Antiabuso atualizado: ${action}` });
    } catch (error) {
      showError(String((error as Error)?.message || "Falha na acao de antiabuso."));
    } finally {
      setLoadingAction(false);
    }
  }

  async function toggleSuspend(suspend: boolean) {
    if (!selectedUserId) {
      showError("Carregue um usuario antes de alterar suspensao.");
      return;
    }

    setLoadingAction(true);
    try {
      await adminSetSuspension({
        userId: selectedUserId,
        suspend,
      });
      await loadUserById(selectedUserId);
      toast({ title: suspend ? "Usuario suspenso" : "Usuario reativado" });
    } catch (error) {
      showError(String((error as Error)?.message || "Falha ao alterar suspensao."));
    } finally {
      setLoadingAction(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-bold">Admin Commerce</h1>
        <p className="text-sm text-muted-foreground">
          Busca por email/UUID, operacoes financeiras auditaveis e visao completa de risco/usage.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5" />
            Buscar usuario
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 md:grid-cols-[1.2fr_1fr_auto]"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void lookupByEmail();
            }}
          >
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                placeholder="usuario@dominio.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label>User ID</Label>
              <Input
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                placeholder="UUID do usuario"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Button type="submit" disabled={loadingUser}>
                {loadingUser ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Buscar por email
              </Button>
              <Button type="button" variant="outline" disabled={loadingUser} onClick={() => void loadUserById(targetUserId)}>
                Carregar por ID
              </Button>
            </div>
          </form>

          {selectedUserId ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">user_id: {selectedUserId}</Badge>
              {data?.user?.email ? <Badge variant="outline">{data.user.email}</Badge> : null}
              {data?.user?.role ? <Badge>{data.user.role}</Badge> : null}
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void loadUserById(selectedUserId)} disabled={loadingUser}>
                Atualizar
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="h-5 w-5" />
              Ajuste manual de creditos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Carteira</Label>
                <Select value={walletType} onValueChange={(v) => setWalletType(v as WalletType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extra_wallet">Extra wallet</SelectItem>
                    <SelectItem value="weekly_wallet">Weekly wallet</SelectItem>
                    <SelectItem value="free_monthly">Free onboarding</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Creditos</Label>
                <Input
                  type="number"
                  min={1}
                  value={credits}
                  onChange={(e) => setCredits(Math.max(1, Number(e.target.value || 1)))}
                />
              </div>
              <div className="space-y-1">
                <Label>Motivo (obrigatorio)</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="ticket, incidente, compensacao..."
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void runCreditAdjust("grant")} disabled={loadingAction || !selectedUserId}>
                {loadingAction ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Creditar
              </Button>
              <Button variant="outline" onClick={() => void runCreditAdjust("debit")} disabled={loadingAction || !selectedUserId}>
                Debitar
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldAlert className="h-5 w-5" />
              Risco e acesso
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void setReview("review")} disabled={loadingAction || !selectedUserId}>
                Review
              </Button>
              <Button variant="outline" onClick={() => void setReview("approve")} disabled={loadingAction || !selectedUserId}>
                Aprovar
              </Button>
              <Button variant="destructive" onClick={() => void setReview("block")} disabled={loadingAction || !selectedUserId}>
                Bloquear abuso
              </Button>
              <Button variant="destructive" onClick={() => void toggleSuspend(true)} disabled={loadingAction || !selectedUserId}>
                <Ban className="mr-1.5 h-4 w-4" />
                Suspender
              </Button>
              <Button variant="outline" onClick={() => void toggleSuspend(false)} disabled={loadingAction || !selectedUserId}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Reativar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Todas as acoes acima ficam auditadas em ledger/sinais, com `reason` recomendado para rastreabilidade.
            </p>
          </CardContent>
        </Card>
      </div>

      {data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base"><User className="h-4 w-4" />Usuario</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div><strong>Email:</strong> {String(data?.user?.email || "-")}</div>
                <div><strong>Role:</strong> {String(data?.user?.role || "-")}</div>
                <div><strong>Email confirmado:</strong> {data?.user?.email_confirmed_at ? "sim" : "nao"}</div>
                <div><strong>Criado:</strong> {formatDateTime(data?.user?.created_at)}</div>
                <div><strong>Ultimo login:</strong> {formatDateTime(data?.user?.last_sign_in_at)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Conta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div><strong>Plano:</strong> {String(data?.account?.plan_type || "-")}</div>
                <div><strong>Estado:</strong> {formatAccessState(data?.account?.access_state)}</div>
                <div><strong>Free elegivel:</strong> {data?.account?.free_eligible ? "sim" : "nao"}</div>
                <div><strong>Review abuso:</strong> {data?.account?.anti_abuse_review_required ? "sim" : "nao"}</div>
                <div><strong>Motivo:</strong> {String(data?.account?.anti_abuse_reason || "-")}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Wallet</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div><strong>Disponivel agora (calculado):</strong> {spendableNow}</div>
                <div><strong>Weekly:</strong> {weeklyNow}</div>
                {freeOnboardingNow > 0 ? <div><strong>Bonus inicial (one-time):</strong> {freeOnboardingNow}</div> : null}
                <div><strong>Extra:</strong> {extraNow}</div>
                <div className="pt-1 text-muted-foreground">Pool do ciclo (contabil, nao gasta direto): {monthlyPoolNow}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Assinatura</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div><strong>Status:</strong> {formatSubscriptionStatus(data?.subscription?.status)}</div>
                <div><strong>Provider:</strong> {String(data?.subscription?.provider || "-")}</div>
                <div><strong>Inicio ciclo:</strong> {formatDateTime(data?.subscription?.current_period_start)}</div>
                <div><strong>Fim ciclo:</strong> {formatDateTime(data?.subscription?.current_period_end)}</div>
                <div><strong>Cancel at period end:</strong> {data?.subscription?.cancel_at_period_end ? "sim" : "nao"}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Ledger (ultimas 100 entradas)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(data.ledger || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem movimentacoes.</p>
              ) : (
                (data.ledger || []).slice(0, 60).map((entry) => (
                  <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 p-2 text-xs">
                    <div className="space-y-0.5">
                      <div className="font-medium">{ENTRY_TYPE_LABELS[String(entry.entry_type || "")] || String(entry.entry_type || "-")}</div>
                      <div className="text-muted-foreground">
                        {WALLET_LABELS[String(entry.wallet_type || "")] || String(entry.wallet_type || "-")}
                        {entry.tool_code ? ` | ${TOOL_LABELS[String(entry.tool_code)] || String(entry.tool_code)}` : ""}
                        {entry.reason ? ` | motivo: ${entry.reason}` : ""}
                        {(entry.actor_user_id || entry.actor_display_name || entry.actor_email) ? ` | por: ${formatActorLabel(entry)}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={Number(entry.delta || 0) < 0 ? "font-semibold text-destructive" : "font-semibold text-emerald-600"}>
                        {formatDelta(entry.delta)}
                      </div>
                      <div className="text-muted-foreground">{formatDateTime(entry.created_at)}</div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Tentativas de uso (ultimas 50)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(data.attempts || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem tentativas registradas.</p>
                ) : (
                  (data.attempts || []).map((attempt) => (
                    <div key={attempt.id} className="rounded-md border border-border/70 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{TOOL_LABELS[String(attempt.tool_code || "")] || String(attempt.tool_code || "-")}</div>
                        <Badge variant="outline">{String(attempt.status || "-")}</Badge>
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        required: {Number(attempt.credits_required || 0)} • upstream: {attempt.upstream_status ?? "-"} • error: {String(attempt.error_code || "-")}
                      </div>
                      <div className="mt-1 text-muted-foreground">{formatDateTime(attempt.created_at)}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sinais de antiabuso (ultimos 50)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(data.abuse_signals || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem sinais recentes.</p>
                ) : (
                  (data.abuse_signals || []).map((signal) => (
                    <div key={signal.id} className="rounded-md border border-border/70 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{String(signal.signal_type || "-")}</div>
                        <Badge variant={String(signal.state || "").toLowerCase() === "open" ? "destructive" : "outline"}>
                          {String(signal.state || "-")}
                        </Badge>
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        value: {String(signal.signal_value || "-")}
                        {signal.note ? ` • note: ${signal.note}` : ""}
                      </div>
                      <div className="mt-1 text-muted-foreground">{formatDateTime(signal.created_at)}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Carregue um usuario para ver detalhes de commerce.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
