import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, FolderOpen, Search, Radar, LineChart, ArrowRight, Database, Layers, Clock3, ListFilter } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Project {
  id: string;
  name: string;
  description: string | null;
  island_code: string | null;
  created_at: string;
}

interface ProjectCardData extends Project {
  uploadsCount: number;
  reportsCount: number;
  lastUploadAt: string | null;
}

interface PulseStats {
  totalIslands: number;
  withTitleCache: number;
  withImageCache: number;
  metadataQueued: number;
  metadataWithTitle: number;
  metadataDueNow: number;
  railsResolutionPct: number | null;
}

function fmtCompact(v: number, locale: string) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString(locale);
}

export default function AppDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [pulse, setPulse] = useState<PulseStats | null>(null);
  const [projectCards, setProjectCards] = useState<ProjectCardData[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectSort, setProjectSort] = useState<"recent" | "name" | "reports">("recent");

  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

  const fetchDashboard = async () => {
    try {
      const [projectsRes, uploadsRes, censusRes, metaRes, linkRes] = await Promise.all([
        supabase.from("projects").select("*").order("created_at", { ascending: false }),
        supabase.from("uploads").select("project_id, created_at, reports(id)"),
        supabase.rpc("get_census_stats"),
        supabase.rpc("get_metadata_pipeline_stats"),
        supabase.rpc("get_link_graph_stats"),
      ]);

      if (!projectsRes.error && projectsRes.data) {
        setProjects(projectsRes.data);
        const uploadsByProject = new Map<string, { uploads: number; reports: number; lastUpload: string | null }>();

        for (const row of (uploadsRes.data || []) as any[]) {
          const current = uploadsByProject.get(row.project_id) || { uploads: 0, reports: 0, lastUpload: null };
          current.uploads += 1;
          current.reports += Array.isArray(row.reports) ? row.reports.length : 0;
          if (!current.lastUpload || +new Date(row.created_at) > +new Date(current.lastUpload)) {
            current.lastUpload = row.created_at;
          }
          uploadsByProject.set(row.project_id, current);
        }

        const cards: ProjectCardData[] = projectsRes.data.map((p) => {
          const agg = uploadsByProject.get(p.id);
          return {
            ...p,
            uploadsCount: agg?.uploads || 0,
            reportsCount: agg?.reports || 0,
            lastUploadAt: agg?.lastUpload || null,
          };
        });
        setProjectCards(cards);
      }

      const census = (censusRes?.data || {}) as any;
      const meta = (metaRes?.data || {}) as any;
      const link = (linkRes?.data || {}) as any;

      setPulse({
        totalIslands: Number(census.total_islands || 0),
        withTitleCache: Number(census.with_title || 0),
        withImageCache: Number(census.with_image || 0),
        metadataQueued: Number(meta.total || 0),
        metadataWithTitle: Number(meta.with_title || 0),
        metadataDueNow: Number(meta.due_now || 0),
        railsResolutionPct:
          link.resolution_24h_pct != null ? Number(link.resolution_24h_pct) : null,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCreating(true);
    const { error } = await supabase
      .from("projects")
      .insert({ name: newName, island_code: newCode || null, user_id: user.id });

    if (error) {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } else {
      toast({ title: t("app.projectCreated") });
      setNewName("");
      setNewCode("");
      setDialogOpen(false);
      fetchDashboard();
    }
    setCreating(false);
  };

  const coveragePct = useMemo(() => {
    if (!pulse?.totalIslands) return 0;
    return (pulse.withTitleCache / pulse.totalIslands) * 100;
  }, [pulse]);

  const metadataCoveragePct = useMemo(() => {
    if (!pulse?.metadataQueued) return 0;
    return (pulse.metadataWithTitle / pulse.metadataQueued) * 100;
  }, [pulse]);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    let list = [...projectCards];
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.island_code || "").toLowerCase().includes(q));
    }
    if (projectSort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    if (projectSort === "reports") list.sort((a, b) => b.reportsCount - a.reportsCount);
    if (projectSort === "recent") list.sort((a, b) => +new Date(b.lastUploadAt || b.created_at) - +new Date(a.lastUploadAt || a.created_at));
    return list;
  }, [projectCards, projectSearch, projectSort]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("app.dashTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("app.dashSubtitle")}</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> {t("app.newProject")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("app.createProject")}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>{t("app.islandName")}</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("app.islandNamePlaceholder")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>{t("app.islandCode")}</Label>
                <Input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder={t("app.islandCodePlaceholder")}
                />
              </div>
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? t("app.creating") : t("app.createProject")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Client Tools
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                Island Lookup Pro
              </CardTitle>
              <CardDescription>
                Compare ilhas, leia footprint de discover e veja historico semanal em um lugar.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link to="/app/island-lookup">
                  Abrir ferramenta <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-primary" />
                CSV Analytics Workspace
              </CardTitle>
              <CardDescription>
                Faça upload de ZIP, gere report e acompanhe historico por projeto.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" asChild>
                <a href="#projects">
                  Ir para projetos <ArrowRight className="h-4 w-4 ml-2" />
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Radar className="h-4 w-4 text-primary" />
                Discover Live
              </CardTitle>
              <CardDescription>
                Veja premium, emerging e pollution com atualizacao em tempo quase real.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/discover">
                  Abrir discover <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Quick Pulse
        </h2>
        {loading ? (
          <div className="flex justify-center py-6">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Database className="h-3.5 w-3.5" />
                  Islands tracked
                </p>
                <p className="font-display text-xl font-bold mt-1">
                  {fmtCompact(pulse?.totalIslands || 0, locale)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Titles in cache: {coveragePct.toFixed(1)}%
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" />
                  Metadata queue
                </p>
                <p className="font-display text-xl font-bold mt-1">
                  {fmtCompact(pulse?.metadataQueued || 0, locale)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  With title: {metadataCoveragePct.toFixed(1)}%
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <LineChart className="h-3.5 w-3.5" />
                  Metadata due now
                </p>
                <p className="font-display text-xl font-bold mt-1">
                  {fmtCompact(pulse?.metadataDueNow || 0, locale)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Quanto menor, melhor.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Radar className="h-3.5 w-3.5" />
                  Rails resolution (24h)
                </p>
                <p className="font-display text-xl font-bold mt-1">
                  {pulse?.railsResolutionPct != null
                    ? `${(pulse.railsResolutionPct * 100).toFixed(1)}%`
                    : "--"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Cobertura de collections no link graph.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </section>

      <section id="projects" className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Projetos CSV
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                className="pl-9 w-full sm:w-64"
                placeholder="Buscar projeto ou codigo"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <ListFilter className="h-4 w-4 text-muted-foreground" />
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={projectSort}
                onChange={(e) => setProjectSort(e.target.value as any)}
              >
                <option value="recent">Mais recente</option>
                <option value="reports">Mais reports</option>
                <option value="name">Nome (A-Z)</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground">{filteredProjects.length} projeto(s)</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-display text-lg font-semibold mb-2">{t("app.noProjects")}</h3>
              <p className="text-sm text-muted-foreground mb-4">{t("app.noProjectsDesc")}</p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> {t("app.createFirst")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((p) => (
              <Link to={`/app/projects/${p.id}`} key={p.id}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardHeader>
                    <CardTitle className="font-display text-lg">{p.name}</CardTitle>
                    <CardDescription>{p.island_code || t("app.noCode")}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Uploads</span>
                      <span className="font-medium">{p.uploadsCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Reports</span>
                      <span className="font-medium">{p.reportsCount}</span>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
                      <Clock3 className="h-3.5 w-3.5" />
                      {p.lastUploadAt
                        ? `Ultimo upload: ${new Date(p.lastUploadAt).toLocaleDateString(locale)}`
                        : `${t("app.createdAt")} ${new Date(p.created_at).toLocaleDateString(locale)}`}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
