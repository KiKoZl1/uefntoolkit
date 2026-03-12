import { FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  adminDebitCredits,
  adminGetCommerceUser,
  adminGrantCredits,
  adminSetAbuseReview,
  adminSetSuspension,
} from "@/lib/commerce/client";

export default function AdminCommerce() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [credits, setCredits] = useState(100);
  const [reason, setReason] = useState("");
  const [data, setData] = useState<any>(null);

  async function loadUser() {
    if (!targetUserId.trim()) return;
    setLoading(true);
    try {
      const res = await adminGetCommerceUser(targetUserId.trim());
      setData(res);
    } catch (error) {
      toast({
        title: "Erro",
        description: String((error as Error)?.message || "Falha ao carregar usuario."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function grant() {
    if (!targetUserId.trim() || !reason.trim()) return;
    setLoading(true);
    try {
      await adminGrantCredits({
        userId: targetUserId.trim(),
        walletType: "extra_wallet",
        credits: Math.max(1, Math.floor(credits)),
        reason: reason.trim(),
      });
      await loadUser();
      toast({ title: "Grant aplicado" });
    } catch (error) {
      toast({
        title: "Erro",
        description: String((error as Error)?.message || "Falha ao aplicar grant."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function debit() {
    if (!targetUserId.trim() || !reason.trim()) return;
    setLoading(true);
    try {
      await adminDebitCredits({
        userId: targetUserId.trim(),
        walletType: "extra_wallet",
        credits: Math.max(1, Math.floor(credits)),
        reason: reason.trim(),
      });
      await loadUser();
      toast({ title: "Debito aplicado" });
    } catch (error) {
      toast({
        title: "Erro",
        description: String((error as Error)?.message || "Falha ao aplicar debito."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function setReview(action: "approve" | "review" | "block") {
    if (!targetUserId.trim()) return;
    setLoading(true);
    try {
      await adminSetAbuseReview({
        userId: targetUserId.trim(),
        action,
        reason: reason.trim() || undefined,
      });
      await loadUser();
      toast({ title: `Antiabuso: ${action}` });
    } catch (error) {
      toast({
        title: "Erro",
        description: String((error as Error)?.message || "Falha na acao de antiabuso."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function toggleSuspend(suspend: boolean) {
    if (!targetUserId.trim()) return;
    setLoading(true);
    try {
      await adminSetSuspension({
        userId: targetUserId.trim(),
        suspend,
      });
      await loadUser();
      toast({ title: suspend ? "Usuario suspenso" : "Usuario reativado" });
    } catch (error) {
      toast({
        title: "Erro",
        description: String((error as Error)?.message || "Falha ao alterar suspensao."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-bold">Admin Commerce</h1>
        <p className="text-sm text-muted-foreground">Operacoes de suporte para creditos, antiabuso e suspensao.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Buscar usuario</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 md:flex-row md:items-end"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void loadUser();
            }}
          >
            <div className="flex-1 space-y-1">
              <Label>User ID</Label>
              <Input value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)} placeholder="UUID do usuario" />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Carregar
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ajuste manual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
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
              <Label>Motivo</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo obrigatorio" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void grant()} disabled={loading}>Grant Extra Wallet</Button>
            <Button variant="outline" onClick={() => void debit()} disabled={loading}>Debitar Extra Wallet</Button>
            <Button variant="secondary" onClick={() => void setReview("review")} disabled={loading}>Marcar Review</Button>
            <Button variant="destructive" onClick={() => void setReview("block")} disabled={loading}>Bloquear Abuso</Button>
            <Button variant="outline" onClick={() => void setReview("approve")} disabled={loading}>Aprovar Abuso</Button>
            <Button variant="destructive" onClick={() => void toggleSuspend(true)} disabled={loading}>Suspender</Button>
            <Button variant="outline" onClick={() => void toggleSuspend(false)} disabled={loading}>Reativar</Button>
          </div>
        </CardContent>
      </Card>

      {data ? (
        <Card>
          <CardHeader>
            <CardTitle>Resumo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-4">
              <div>Plano: <strong>{String(data?.account?.plan_type || "-")}</strong></div>
              <div>Estado: <strong>{String(data?.account?.access_state || "-")}</strong></div>
              <div>Weekly: <strong>{Number(data?.wallet?.weekly_wallet || 0)}</strong></div>
              <div>Extra: <strong>{Number(data?.wallet?.extra_wallet || 0)}</strong></div>
            </div>
            <div>
              <p className="mb-1 font-medium">Ultimas entradas de ledger</p>
              <pre className="max-h-72 overflow-auto rounded border border-border/70 p-3 text-xs">
                {JSON.stringify(data?.ledger || [], null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
