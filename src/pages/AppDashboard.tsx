import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, FolderOpen, Search, FileText, Upload, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Project {
  id: string;
  name: string;
  description: string | null;
  island_code: string | null;
  created_at: string;
  uploads_count: number;
  reports_count: number;
  last_upload_at: string | null;
}

type SortMode = "recent" | "name" | "reports";

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
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");

  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

  const fetchProjects = async () => {
    const { data: projs, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
    if (error || !projs) { setLoading(false); return; }

    // Enrich with counts
    const ids = projs.map(p => p.id);
    const [uploadsRes, reportsRes] = await Promise.all([
      supabase.from("uploads").select("id, project_id, created_at").in("project_id", ids),
      supabase.from("reports").select("id, project_id").in("project_id", ids),
    ]);

    const uploadsMap = new Map<string, { count: number; lastAt: string | null }>();
    const reportsMap = new Map<string, number>();

    (uploadsRes.data || []).forEach((u: any) => {
      const cur = uploadsMap.get(u.project_id) || { count: 0, lastAt: null };
      cur.count++;
      if (!cur.lastAt || u.created_at > cur.lastAt) cur.lastAt = u.created_at;
      uploadsMap.set(u.project_id, cur);
    });
    (reportsRes.data || []).forEach((r: any) => {
      reportsMap.set(r.project_id, (reportsMap.get(r.project_id) || 0) + 1);
    });

    setProjects(projs.map(p => ({
      ...p,
      uploads_count: uploadsMap.get(p.id)?.count || 0,
      reports_count: reportsMap.get(p.id) || 0,
      last_upload_at: uploadsMap.get(p.id)?.lastAt || null,
    })));
    setLoading(false);
  };

  useEffect(() => { fetchProjects(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCreating(true);
    const { error } = await supabase.from("projects").insert({ name: newName, island_code: newCode || null, user_id: user.id });
    if (error) {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } else {
      toast({ title: t("app.projectCreated") });
      setNewName("");
      setNewCode("");
      setDialogOpen(false);
      fetchProjects();
    }
    setCreating(false);
  };

  const filtered = useMemo(() => {
    let list = projects;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.island_code || "").toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "reports") sorted.sort((a, b) => b.reports_count - a.reports_count);
    // "recent" is default order
    return sorted;
  }, [projects, search, sort]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("app.dashTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("app.dashSubtitle")}</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> {t("app.newProject")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("app.createProject")}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>{t("app.islandName")}</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("app.islandNamePlaceholder")} required />
              </div>
              <div className="space-y-2">
                <Label>{t("app.islandCode")}</Label>
                <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder={t("app.islandCodePlaceholder")} />
              </div>
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? t("app.creating") : t("app.createProject")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search & Sort */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar projetos..." className="pl-10" />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Mais recentes</SelectItem>
            <SelectItem value="name">Nome A-Z</SelectItem>
            <SelectItem value="reports">Mais reports</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-display text-lg font-semibold mb-2">
              {search ? "Nenhum projeto encontrado" : t("app.noProjects")}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {search ? "Tente outro termo de busca." : t("app.noProjectsDesc")}
            </p>
            {!search && (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> {t("app.createFirst")}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <Link to={`/app/projects/${p.id}`} key={p.id}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="font-display text-lg">{p.name}</CardTitle>
                  <CardDescription>{p.island_code || t("app.noCode")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Upload className="h-3 w-3" /> {p.uploads_count} uploads</span>
                    <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> {p.reports_count} reports</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t("app.createdAt")} {new Date(p.created_at).toLocaleDateString(locale)}
                    </span>
                    {p.last_upload_at && (
                      <Badge variant="outline" className="text-[10px]">
                        Último upload: {new Date(p.last_upload_at).toLocaleDateString(locale)}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
