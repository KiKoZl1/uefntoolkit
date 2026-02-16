import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Project {
  id: string;
  name: string;
  description: string | null;
  island_code: string | null;
  created_at: string;
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

  const locale = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

  const fetchProjects = async () => {
    const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
    if (!error && data) setProjects(data);
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
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

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : projects.length === 0 ? (
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
          {projects.map((p) => (
            <Link to={`/app/projects/${p.id}`} key={p.id}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardHeader>
                  <CardTitle className="font-display text-lg">{p.name}</CardTitle>
                  <CardDescription>{p.island_code || t("app.noCode")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {t("app.createdAt")} {new Date(p.created_at).toLocaleDateString(locale)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
