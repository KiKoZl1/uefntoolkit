import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldPlus, ShieldX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TgisAdminHeader, fmtCompact, fmtDate } from "./shared";

export default function AdminTgisSafety() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [term, setTerm] = useState("");
  const [terms, setTerms] = useState<any[]>([]);
  const [blockedRows, setBlockedRows] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [termsRes, blockedRes] = await Promise.all([
      (supabase as any)
        .from("tgis_blocklist_terms")
        .select("term,is_active,reason,updated_at")
        .order("term", { ascending: true }),
      (supabase as any)
        .from("tgis_generation_log")
        .select("id,category,status,error_text,created_at")
        .eq("status", "blocked")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setTerms(Array.isArray(termsRes.data) ? termsRes.data : []);
    setBlockedRows(Array.isArray(blockedRes.data) ? blockedRes.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTerm(ev: FormEvent) {
    ev.preventDefault();
    const normalized = term.trim().toLowerCase();
    if (!normalized) return;
    setSaving(true);
    await (supabase as any).from("tgis_blocklist_terms").upsert({ term: normalized, is_active: true });
    setTerm("");
    await load();
    setSaving(false);
  }

  async function toggle(termValue: string, active: boolean) {
    await (supabase as any).from("tgis_blocklist_terms").update({ is_active: !active, updated_at: new Date().toISOString() }).eq("term", termValue);
    await load();
  }

  const stats = useMemo(() => {
    return {
      terms: terms.length,
      activeTerms: terms.filter((x) => x.is_active).length,
      blocked24h: blockedRows.filter((x) => Date.parse(x.created_at || "") > Date.now() - 24 * 3600_000).length,
    };
  }, [terms, blockedRows]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <TgisAdminHeader
        title="TGIS Safety"
        subtitle="Prompt safety moderado: termos bloqueados e auditoria de bloqueios em runtime."
        right={<Button variant="outline" className="gap-2" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" />Reload</Button>}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Terms</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.terms)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Active terms</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.activeTerms)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Blocked (24h)</p><p className="mt-1 text-2xl font-semibold">{fmtCompact(stats.blocked24h)}</p></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Blocklist terms</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <form className="flex gap-2" onSubmit={addTerm}>
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="new blocked term" />
              <Button type="submit" disabled={saving || !term.trim()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldPlus className="h-4 w-4" />}</Button>
            </form>

            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
            ) : terms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No terms configured.</p>
            ) : (
              <div className="space-y-2">
                {terms.slice(0, 120).map((row) => (
                  <div key={`term:${row.term}`} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <div>
                      <p className="font-medium">{row.term}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(row.updated_at)}</p>
                    </div>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => toggle(row.term, !!row.is_active)}>
                      <ShieldX className="h-3.5 w-3.5" />
                      {row.is_active ? "Disable" : "Enable"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Blocked generation events</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
            ) : blockedRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No blocked generation events.</p>
            ) : (
              <div className="space-y-2">
                {blockedRows.slice(0, 80).map((row) => (
                  <div key={`blk:${row.id}`} className="rounded-md border p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{row.category || "-"}</p>
                      <Badge variant="outline">blocked</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{fmtDate(row.created_at)}</p>
                    <p className="mt-1 text-xs text-destructive">{row.error_text || "blocked"}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
