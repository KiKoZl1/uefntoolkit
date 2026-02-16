import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Layers, Save, Plus, Trash2, Search, RefreshCw } from "lucide-react";

interface PanelTier {
  panel_name: string;
  tier: number;
  label: string | null;
  updated_at: string;
}

export default function AdminPanelManager() {
  const { toast } = useToast();
  const [panels, setPanels] = useState<PanelTier[]>([]);
  const [allPanelNames, setAllPanelNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, { label: string; tier: number }>>({});
  const [newPanel, setNewPanel] = useState({ panel_name: "", label: "", tier: 2 });

  const fetchPanels = async () => {
    setLoading(true);
    const [{ data: tiers }, { data: rollup }] = await Promise.all([
      supabase.from("discovery_panel_tiers").select("*").order("panel_name"),
      supabase.from("discovery_exposure_rollup_daily").select("panel_name").limit(1000),
    ]);

    const tierMap = new Map<string, PanelTier>();
    for (const t of tiers || []) tierMap.set(t.panel_name, t as PanelTier);
    setPanels(Array.from(tierMap.values()));

    const uniqueNames = new Set<string>();
    for (const r of rollup || []) uniqueNames.add(r.panel_name);
    for (const t of tiers || []) uniqueNames.add(t.panel_name);
    setAllPanelNames(Array.from(uniqueNames).sort());
    setLoading(false);
  };

  useEffect(() => { fetchPanels(); }, []);

  const unmanagedPanels = allPanelNames.filter(
    (n) => !panels.find((p) => p.panel_name === n)
  );

  const handleSave = async (panelName: string) => {
    const edit = edits[panelName];
    if (!edit) return;
    setSaving(panelName);
    const { error } = await supabase
      .from("discovery_panel_tiers")
      .upsert({ panel_name: panelName, label: edit.label || null, tier: edit.tier, updated_at: new Date().toISOString() }, { onConflict: "panel_name" });
    setSaving(null);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved!" });
      setEdits((prev) => { const n = { ...prev }; delete n[panelName]; return n; });
      fetchPanels();
    }
  };

  const handleAdd = async () => {
    if (!newPanel.panel_name) return;
    setSaving("__new__");
    const { error } = await supabase
      .from("discovery_panel_tiers")
      .upsert({ panel_name: newPanel.panel_name, label: newPanel.label || null, tier: newPanel.tier, updated_at: new Date().toISOString() }, { onConflict: "panel_name" });
    setSaving(null);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Panel added!" });
      setNewPanel({ panel_name: "", label: "", tier: 2 });
      fetchPanels();
    }
  };

  const handleDelete = async (panelName: string) => {
    const { error } = await supabase.from("discovery_panel_tiers").delete().eq("panel_name", panelName);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Deleted" });
      fetchPanels();
    }
  };

  const getEdit = (p: PanelTier) => edits[p.panel_name] || { label: p.label || "", tier: p.tier };

  const filtered = panels.filter((p) =>
    !search || p.panel_name.toLowerCase().includes(search.toLowerCase()) || (p.label || "").toLowerCase().includes(search.toLowerCase())
  );

  const tierLabel = (t: number) => t === 1 ? "Premium" : t === 2 ? "Standard" : t === 3 ? "Low" : `Tier ${t}`;
  const tierColor = (t: number) => t === 1 ? "bg-yellow-500/15 text-yellow-600 border-yellow-500/30" : t === 2 ? "bg-blue-500/15 text-blue-600 border-blue-500/30" : "bg-muted text-muted-foreground";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Panel Manager</h1>
        <p className="text-sm text-muted-foreground">
          Rename Discovery panels and assign tiers. Labels are used in reports. Panels starting with "Browse" are automatically excluded from report metrics.
        </p>
      </div>

      {/* Add new */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" /> Add / Update Panel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">Panel Name (raw)</label>
              <Input
                value={newPanel.panel_name}
                onChange={(e) => setNewPanel({ ...newPanel, panel_name: e.target.value })}
                placeholder="Nested_Horror"
                list="unmanaged-panels"
              />
              <datalist id="unmanaged-panels">
                {unmanagedPanels.map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">Display Label</label>
              <Input
                value={newPanel.label}
                onChange={(e) => setNewPanel({ ...newPanel, label: e.target.value })}
                placeholder="Horror"
              />
            </div>
            <div className="w-32">
              <label className="text-xs text-muted-foreground mb-1 block">Tier</label>
              <Select value={String(newPanel.tier)} onValueChange={(v) => setNewPanel({ ...newPanel, tier: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Premium</SelectItem>
                  <SelectItem value="2">Standard</SelectItem>
                  <SelectItem value="3">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAdd} disabled={!newPanel.panel_name || saving === "__new__"} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          {unmanagedPanels.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {unmanagedPanels.length} panels detected without labels.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Search & refresh */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search panels..." className="pl-9" />
        </div>
        <Button variant="outline" size="sm" onClick={fetchPanels} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Panel list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Managed Panels ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filtered.map((p) => {
            const edit = getEdit(p);
            const isDirty = edit.label !== (p.label || "") || edit.tier !== p.tier;
            const isBrowse = p.panel_name.startsWith("Browse");
            return (
              <div key={p.panel_name} className={`flex items-center gap-2 rounded-md border p-2 ${isBrowse ? "opacity-50" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-muted-foreground truncate">{p.panel_name}</code>
                    <Badge variant="outline" className={`text-[10px] ${tierColor(p.tier)}`}>{tierLabel(p.tier)}</Badge>
                    {isBrowse && <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-500 border-red-500/30">Excluded</Badge>}
                  </div>
                </div>
                <Input
                  value={edit.label}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [p.panel_name]: { ...edit, label: e.target.value } }))}
                  placeholder="Display name..."
                  className="w-48 h-8 text-xs"
                />
                <Select value={String(edit.tier)} onValueChange={(v) => setEdits((prev) => ({ ...prev, [p.panel_name]: { ...edit, tier: Number(v) } }))}>
                  <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Premium</SelectItem>
                    <SelectItem value="2">Standard</SelectItem>
                    <SelectItem value="3">Low</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => handleSave(p.panel_name)} disabled={!isDirty || saving === p.panel_name}>
                  <Save className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDelete(p.panel_name)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No panels found.</p>}
        </CardContent>
      </Card>

      {/* Unmanaged panels */}
      {unmanagedPanels.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unmanaged Panels ({unmanagedPanels.filter((n) => !search || n.toLowerCase().includes(search.toLowerCase())).length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {unmanagedPanels
                .filter((n) => !search || n.toLowerCase().includes(search.toLowerCase()))
                .map((n) => (
                  <Badge
                    key={n}
                    variant="outline"
                    className={`text-[10px] cursor-pointer hover:bg-accent ${n.startsWith("Browse") ? "opacity-40 line-through" : ""}`}
                    onClick={() => setNewPanel({ panel_name: n, label: "", tier: 2 })}
                  >
                    {n}
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
