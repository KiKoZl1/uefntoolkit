import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Eye, TrendingUp, AlertTriangle, Loader2 } from "lucide-react";

type PremiumRow = {
  as_of: string;
  region: string;
  surface_name: string;
  panel_name: string;
  panel_display_name: string | null;
  rank: number;
  link_code: string;
  link_code_type: string;
  ccu: number | null;
  title: string | null;
  creator_code: string | null;
};

type EmergingRow = {
  as_of: string;
  region: string;
  surface_name: string;
  link_code: string;
  link_code_type: string;
  first_seen_at: string;
  minutes_6h: number;
  minutes_24h: number;
  panels_24h: number;
  premium_panels_24h: number;
  reentries_24h: number;
  score: number;
  title: string | null;
  creator_code: string | null;
};

type PollutionRow = {
  as_of: string;
  creator_code: string;
  duplicate_clusters_7d: number;
  duplicate_islands_7d: number;
  duplicates_over_min: number;
  spam_score: number;
  sample_titles: string[] | null;
};

type RailChild = {
  linkCode: string;
  title: string;
  imageUrl: string | null;
  creatorCode: string | null;
  ccu: number | null;
  edgeType: string | null;
};

type RailItem = {
  rank: number;
  linkCode: string;
  linkCodeType: string;
  title: string;
  imageUrl: string | null;
  creatorCode: string | null;
  ccu: number | null;
  children?: RailChild[];
};

type Rail = {
  panelName: string;
  panelDisplayName: string;
  items: RailItem[];
};

type PremiumViewItem = {
  rank: number;
  title: string;
  linkCode: string;
  linkCodeType: string;
  creatorCode: string | null;
  ccu: number | null;
  children?: RailChild[];
};

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("en-US");
}

export default function DiscoverLive() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

  const [loading, setLoading] = useState(true);
  const [premium, setPremium] = useState<PremiumRow[]>([]);
  const [emerging, setEmerging] = useState<EmergingRow[]>([]);
  const [pollution, setPollution] = useState<PollutionRow[]>([]);

  const [rails, setRails] = useState<Rail[]>([]);
  const [railsLoading, setRailsLoading] = useState(false);
  const [railsError, setRailsError] = useState<string | null>(null);

  const [region, setRegion] = useState<string>("NAE");
  const [surface, setSurface] = useState<string>("CreativeDiscoverySurface_Frontend");
  const [panelName, setPanelName] = useState<string>("");

  async function load() {
    setLoading(true);
    const [p, e, pol] = await Promise.all([
      (supabase as any).from("discovery_public_premium_now").select("*").limit(5000),
      (supabase as any).from("discovery_public_emerging_now").select("*").limit(5000),
      (supabase as any).from("discovery_public_pollution_creators_now").select("*").limit(2000),
    ]);

    if (p.data) setPremium(p.data as PremiumRow[]);
    if (e.data) setEmerging(e.data as EmergingRow[]);
    if (pol.data) setPollution(pol.data as PollutionRow[]);
    setLoading(false);
  }

  async function loadRails() {
    setRailsLoading(true);
    setRailsError(null);

    const { data, error } = await supabase.functions.invoke("discover-rails-resolver", {
      body: {
        region,
        surfaceName: surface,
        maxPanels: 24,
        maxItemsPerPanel: 60,
        maxChildrenPerCollection: 24,
        includeChildren: true,
      },
    });

    if (error) {
      setRails([]);
      setRailsError(error.message || "Erro ao carregar rails");
      setRailsLoading(false);
      return;
    }

    const rows = Array.isArray((data as any)?.rails) ? ((data as any).rails as Rail[]) : [];
    setRails(rows);
    setRailsLoading(false);
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadRails();
    const timer = setInterval(loadRails, 60_000);
    return () => clearInterval(timer);
  }, [region, surface]);

  const asOf = useMemo(() => {
    const ts = premium[0]?.as_of || emerging[0]?.as_of || pollution[0]?.as_of || null;
    return ts ? new Date(ts) : null;
  }, [premium, emerging, pollution]);

  const premiumRows = useMemo(() => {
    return premium
      .filter((r) => r.region === region && r.surface_name === surface)
      .sort((a, b) => {
        if (a.panel_name !== b.panel_name) return a.panel_name.localeCompare(b.panel_name);
        return a.rank - b.rank;
      });
  }, [premium, region, surface]);

  const panelsFromPremium = useMemo(() => {
    const map = new Map<string, { name: string; display: string }>();
    for (const r of premiumRows) {
      const display = r.panel_display_name || r.panel_name;
      if (!map.has(r.panel_name)) map.set(r.panel_name, { name: r.panel_name, display });
    }
    return Array.from(map.values());
  }, [premiumRows]);

  const panelOptions = useMemo(() => {
    if (rails.length > 0) {
      return rails.map((r) => ({
        name: r.panelName,
        display: r.panelDisplayName || r.panelName,
      }));
    }
    return panelsFromPremium;
  }, [rails, panelsFromPremium]);

  useEffect(() => {
    if (panelOptions.length === 0) {
      setPanelName("");
      return;
    }
    if (!panelName || !panelOptions.find((p) => p.name === panelName)) {
      setPanelName(panelOptions[0].name);
    }
  }, [panelOptions, panelName]);

  const premiumInPanel = useMemo(() => {
    return premiumRows.filter((r) => r.panel_name === panelName).sort((a, b) => a.rank - b.rank).slice(0, 20);
  }, [premiumRows, panelName]);

  const selectedRail = useMemo(() => {
    if (!panelName) return null;
    return rails.find((r) => r.panelName === panelName) || null;
  }, [rails, panelName]);

  const premiumViewItems = useMemo<PremiumViewItem[]>(() => {
    if (selectedRail?.items?.length) {
      return selectedRail.items.slice(0, 20).map((it) => ({
        rank: it.rank,
        title: it.title || it.linkCode,
        linkCode: it.linkCode,
        linkCodeType: it.linkCodeType,
        creatorCode: it.creatorCode || null,
        ccu: it.ccu ?? null,
        children: Array.isArray(it.children) ? it.children.slice(0, 8) : undefined,
      }));
    }

    return premiumInPanel.map((r) => ({
      rank: r.rank,
      title: r.title || r.link_code,
      linkCode: r.link_code,
      linkCodeType: r.link_code_type,
      creatorCode: r.creator_code || null,
      ccu: r.ccu ?? null,
    }));
  }, [selectedRail, premiumInPanel]);

  const emergingRows = useMemo(() => {
    return emerging
      .filter((r) => r.region === region && r.surface_name === surface)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 50);
  }, [emerging, region, surface]);

  const pollutionRows = useMemo(() => {
    return pollution
      .slice()
      .sort((a, b) => (b.spam_score || 0) - (a.spam_score || 0))
      .slice(0, 50);
  }, [pollution]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="px-6 py-12 max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold">{t("discover.title")}</h1>
        <p className="text-muted-foreground">{t("discover.subtitle")}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="font-mono">
            as_of: {asOf ? asOf.toLocaleString(locale) : "-"}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{t("common.filter")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("common.region")}</p>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["NAE", "EU", "BR", "ASIA"].map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("common.surface")}</p>
            <Select value={surface} onValueChange={setSurface}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CreativeDiscoverySurface_Frontend">Frontend</SelectItem>
                <SelectItem value="CreativeDiscoverySurface_Browse">Browse</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("discover.panelPremium")}</p>
            <Select value={panelName} onValueChange={setPanelName}>
              <SelectTrigger><SelectValue placeholder="-" /></SelectTrigger>
              <SelectContent>
                {panelOptions.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.display}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4" /> {t("discover.premiumNow")}
            </CardTitle>
            {railsError && (
              <p className="text-xs text-muted-foreground">
                rails resolver indisponivel, exibindo fallback da snapshot.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {railsLoading ? (
              <p className="text-sm text-muted-foreground">Carregando rail resolvido...</p>
            ) : premiumViewItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("discover.noDataFilter")}</p>
            ) : (
              premiumViewItems.map((item) => (
                <div key={`${panelName}:${item.rank}:${item.linkCode}`} className="rounded-md border p-2 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-muted-foreground">#{item.rank}</p>
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {item.creatorCode ? `@${item.creatorCode}` : item.linkCodeType} - {item.linkCode}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{t("common.ccu")}</p>
                      <p className="font-display font-semibold">{fmtNum(item.ccu)}</p>
                    </div>
                  </div>

                  {Array.isArray(item.children) && item.children.length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-2">
                      {item.children.map((c) => (
                        <div key={c.linkCode} className="rounded border p-2">
                          <p className="text-xs font-medium truncate">{c.title || c.linkCode}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {c.creatorCode ? `@${c.creatorCode}` : c.linkCode}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{t("common.ccu")} {fmtNum(c.ccu)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> {t("discover.emerging")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {emergingRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("discover.noDataFilter")}</p>
            ) : (
              emergingRows.map((r) => (
                <div key={r.link_code} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.title || r.link_code}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {r.creator_code ? `@${r.creator_code}` : r.link_code_type} - {t("discover.firstSeen")} {new Date(r.first_seen_at).toLocaleString(locale)}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      6h: {fmtNum(r.minutes_6h)}m - 24h: {fmtNum(r.minutes_24h)}m - panels: {fmtNum(r.panels_24h)} - premium: {fmtNum(r.premium_panels_24h)} - reentries: {fmtNum(r.reentries_24h)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">{t("common.score")}</p>
                    <p className="font-display font-semibold">{fmtNum(Math.round(r.score))}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {t("discover.pollution")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          {pollutionRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
          ) : (
            pollutionRows.map((r) => (
              <div key={r.creator_code} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">@{r.creator_code}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t("common.clusters")}: {fmtNum(r.duplicate_clusters_7d)} - {t("common.islands")}: {fmtNum(r.duplicate_islands_7d)} - {t("common.overMin")}: {fmtNum(r.duplicates_over_min)}
                    </p>
                  </div>
                  <Badge variant="secondary" className="font-mono">
                    {t("common.score")} {fmtNum(Math.round(r.spam_score))}
                  </Badge>
                </div>
                {Array.isArray(r.sample_titles) && r.sample_titles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {r.sample_titles.slice(0, 3).map((title, idx) => (
                      <p key={idx} className="text-[11px] text-muted-foreground truncate">
                        {title}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
