import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Globe, EyeOff, Loader2 } from "lucide-react";

const SECTION_NAMES = [
  "Core Activity", "Trending Topics", "Player Engagement", "Novas Ilhas",
  "Retention & Loyalty", "Creator Performance", "Map Quality", "Low Performance",
  "Ratios & Derived", "Categories & Tags", "Efficiency", "Risers & Decliners", "Island Lifecycle",
];

export default function AdminReportEditor() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Editable fields
  const [titlePublic, setTitlePublic] = useState("");
  const [subtitlePublic, setSubtitlePublic] = useState("");
  const [editorNote, setEditorNote] = useState("");
  const [editorSections, setEditorSections] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    supabase.from("weekly_reports").select("*").eq("id", id).single().then(({ data }) => {
      if (data) {
        setReport(data);
        setTitlePublic(data.title_public || "");
        setSubtitlePublic(data.subtitle_public || "");
        setEditorNote(data.editor_note || "");
        setEditorSections((data.editor_sections_json as Record<string, string>) || {});
      }
      setLoading(false);
    });
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    const { error } = await supabase.from("weekly_reports").update({
      title_public: titlePublic,
      subtitle_public: subtitlePublic,
      editor_note: editorNote,
      editor_sections_json: editorSections,
    }).eq("id", id);
    setSaving(false);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Salvo!" });
    }
  };

  const togglePublish = async () => {
    if (!id || !report) return;
    const newStatus = report.status === "published" ? "draft" : "published";
    const { error } = await supabase.from("weekly_reports").update({
      status: newStatus,
      published_at: newStatus === "published" ? new Date().toISOString() : null,
    }).eq("id", id);
    if (!error) {
      setReport({ ...report, status: newStatus });
      toast({ title: newStatus === "published" ? "Publicado!" : "Despublicado" });
    }
  };

  const updateSection = (num: number, text: string) => {
    setEditorSections(prev => ({ ...prev, [`section${num}`]: text }));
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!report) return <div className="p-6 text-center text-muted-foreground">Report não encontrado</div>;

  const aiSections = report.ai_sections_json || {};

  return (
    <div className="p-6 max-w-4xl mx-auto pb-20">
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/reports"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {saving ? "Salvando..." : "Salvar"}
          </Button>
          <Button variant={report.status === "published" ? "destructive" : "default"} onClick={togglePublish}>
            {report.status === "published" ? <><EyeOff className="h-4 w-4 mr-1" /> Despublicar</> : <><Globe className="h-4 w-4 mr-1" /> Publicar</>}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Informações Públicas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Título Público</Label>
              <Input value={titlePublic} onChange={(e) => setTitlePublic(e.target.value)} placeholder="Fortnite Discovery - Semana X/2026" />
            </div>
            <div>
              <Label>Subtítulo</Label>
              <Input value={subtitlePublic} onChange={(e) => setSubtitlePublic(e.target.value)} placeholder="Destaques da semana..." />
            </div>
            <div>
              <Label>Nota Editorial (Markdown)</Label>
              <Textarea value={editorNote} onChange={(e) => setEditorNote(e.target.value)} rows={4} placeholder="Comentários e observações da equipe editorial..." />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={report.status === "published" ? "default" : "secondary"}>
                {report.status === "published" ? "Publicado" : "Draft"}
              </Badge>
              <span>Slug: {report.public_slug}</span>
              <span>·</span>
              <span>{report.week_key}</span>
            </div>
          </CardContent>
        </Card>

        {SECTION_NAMES.map((name, idx) => {
          const num = idx + 1;
          const aiText = aiSections[`section${num}`]?.narrative || "";
          const editorText = editorSections[`section${num}`] || "";

          return (
            <Card key={num}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Seção {num}: {name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {aiText && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Texto da IA (original)</Label>
                    <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {aiText}
                    </div>
                  </div>
                )}
                <div>
                  <Label className="text-xs">Texto editado (sobrescreve IA se preenchido)</Label>
                  <Textarea
                    value={editorText}
                    onChange={(e) => updateSection(num, e.target.value)}
                    rows={3}
                    placeholder="Deixe vazio para usar o texto da IA..."
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
