import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { DppiAdminHeader, fmtDate } from "./shared";
import { dataSelect } from "@/lib/discoverDataApi";

const CHANNELS = ["shadow", "candidate", "limited", "production"] as const;

type Channel = typeof CHANNELS[number];

export default function AdminDppiReleases() {
  const [loading, setLoading] = useState(true);
  const [busyChannel, setBusyChannel] = useState<string | null>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [notes, setNotes] = useState("");
  const [opError, setOpError] = useState<string | null>(null);
  const [opOk, setOpOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [channelsRes, modelsRes] = await Promise.all([
      dataSelect<any[]>({
        table: "dppi_release_channels",
        columns: "channel_name,model_name,model_version,notes,updated_at",
        order: [{ column: "channel_name", ascending: true }],
      }),
      dataSelect<any[]>({
        table: "dppi_model_registry",
        columns: "model_name,model_version,task_type,status,updated_at",
        order: [{ column: "updated_at", ascending: false }],
        limit: 60,
      }),
    ]);

    setChannels(Array.isArray(channelsRes.data) ? channelsRes.data : []);
    setModels(Array.isArray(modelsRes.data) ? modelsRes.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setChannel(channelName: Channel, modelName: string | null, modelVersion: string | null) {
    setBusyChannel(channelName);
    setOpError(null);
    setOpOk(null);
    const { data, error } = await supabase.functions.invoke("dppi-release-set", {
      body: { channelName, modelName, modelVersion, notes: notes || null },
    });
    if (error || data?.success === false) {
      const gates = Array.isArray(data?.gate_errors) ? data.gate_errors.join(" | ") : "";
      setOpError(error?.message || data?.error || gates || "release_update_failed");
    } else {
      setOpOk(`Canal ${channelName} atualizado.`);
    }
    await load();
    setBusyChannel(null);
  }

  const latestCandidate = useMemo(
    () => models.find((m) => m.status === "production_candidate") || models[0] || null,
    [models],
  );
  const latestProd = useMemo(
    () => models.find((m) => m.status === "production") || latestCandidate,
    [models, latestCandidate],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <DppiAdminHeader title="DPPI Releases" subtitle="Gestão de canais shadow/candidate/limited/production e rollback operacional." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Release channels</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
            ) : (
              CHANNELS.map((channel) => {
                const row = channels.find((r) => r.channel_name === channel);
                return (
                  <div key={channel} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium uppercase tracking-wide">{channel}</p>
                      <Badge variant="outline">{fmtDate(row?.updated_at)}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {row?.model_name && row?.model_version ? `${row.model_name}:${row.model_version}` : "(empty)"}
                    </p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Quick actions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Nota de auditoria</p>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Motivo da promoção / rollback" />
            </div>
            <Button
              className="w-full"
              disabled={!latestCandidate || busyChannel !== null}
              onClick={() => setChannel("candidate", latestCandidate?.model_name || null, latestCandidate?.model_version || null)}
            >
              {busyChannel === "candidate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Promote latest to candidate
            </Button>
            <Button
              className="w-full"
              variant="outline"
              disabled={!latestCandidate || busyChannel !== null}
              onClick={() => setChannel("limited", latestCandidate?.model_name || null, latestCandidate?.model_version || null)}
            >
              {busyChannel === "limited" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Promote candidate to limited
            </Button>
            <Button
              className="w-full"
              variant="outline"
              disabled={!latestCandidate || busyChannel !== null}
              onClick={() => setChannel("production", latestCandidate?.model_name || null, latestCandidate?.model_version || null)}
            >
              {busyChannel === "production" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Promote candidate to production
            </Button>
            <Button
              className="w-full"
              variant="destructive"
              disabled={!latestProd || busyChannel !== null}
              onClick={() => setChannel("production", latestProd?.model_name || null, latestProd?.model_version || null)}
            >
              {busyChannel === "production" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Rollback production to last stable
            </Button>
            {opError ? <p className="text-xs text-destructive">{opError}</p> : null}
            {opOk ? <p className="text-xs text-emerald-500">{opOk}</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Recent model versions</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2">Model</th>
                  <th className="px-2 py-2">Version</th>
                  <th className="px-2 py-2">Task</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {models.map((row, idx) => (
                  <tr key={`${row.model_name}:${row.model_version}:${idx}`} className="border-b border-border/30">
                    <td className="px-2 py-2">{row.model_name}</td>
                    <td className="px-2 py-2">{row.model_version}</td>
                    <td className="px-2 py-2">{row.task_type}</td>
                    <td className="px-2 py-2"><Badge variant="outline">{row.status}</Badge></td>
                    <td className="px-2 py-2">{fmtDate(row.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

