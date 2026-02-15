import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Globe, EyeOff, Loader2, Upload, Image, ChevronDown, Bold, Italic, Link2, Eye } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { ReportPreview } from "@/components/admin/ReportPreview";

const SECTION_NAMES = [
  "Core Activity", "Trending Topics", "Player Engagement", "Novas Ilhas",
  "Retention & Loyalty", "Creator Performance", "Map Quality", "Low Performance",
  "Ratios & Derived", "Categories & Tags", "Efficiency", "Risers & Decliners", "Island Lifecycle",
  "Discovery Exposure",
];

export default function AdminReportEditor() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [titlePublic, setTitlePublic] = useState("");
  const [subtitlePublic, setSubtitlePublic] = useState("");
  const [editorNote, setEditorNote] = useState("");
  const [editorSections, setEditorSections] = useState<Record<string, string>>({});
  const [coverUrl, setCoverUrl] = useState("");
  const [sectionPreviews, setSectionPreviews] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!id) return;
    supabase.from("weekly_reports").select("*").eq("id", id).single().then(({ data }) => {
      if (data) {
        setReport(data);
        setTitlePublic(data.title_public || "");
        setSubtitlePublic(data.subtitle_public || "");
        setEditorNote(data.editor_note || "");
        setEditorSections((data.editor_sections_json as Record<string, string>) || {});
        setCoverUrl((data as any).cover_image_url || "");
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
      cover_image_url: coverUrl || null,
    } as any).eq("id", id);
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

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `covers/${id}.${ext}`;
    const { error } = await supabase.storage.from("report-assets").upload(path, file, { upsert: true });
    if (error) {
      toast({ title: "Erro no upload", description: error.message, variant: "destructive" });
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("report-assets").getPublicUrl(path);
    setCoverUrl(urlData.publicUrl);
    setUploading(false);
    toast({ title: "Capa enviada!" });
  };

  const updateSection = (num: number, text: string) => {
    setEditorSections(prev => ({ ...prev, [`section${num}`]: text }));
  };

  const insertMarkdown = (num: number, prefix: string, suffix: string) => {
    const textarea = document.getElementById(`section-editor-${num}`) as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = editorSections[`section${num}`] || "";
    const selected = text.substring(start, end);
    const newText = text.substring(0, start) + prefix + selected + suffix + text.substring(end);
    updateSection(num, newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const toggleSectionPreview = (num: number) => {
    setSectionPreviews(prev => ({ ...prev, [num]: !prev[num] }));
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!report) return <div className="p-6 text-center text-muted-foreground">Report não encontrado</div>;

  const aiSections = report.ai_sections_json || {};

  return (
    <div className="p-6 max-w-5xl mx-auto pb-20">
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

      <Tabs defaultValue="edit" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="edit">✏️ Editar</TabsTrigger>
          <TabsTrigger value="preview">👁️ Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          <div className="space-y-6">
            {/* Cover Image */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Imagem de Capa</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-4">
                  {coverUrl ? (
                    <div className="relative group">
                      <img src={coverUrl} alt="Cover" className="h-32 w-56 object-cover rounded-lg border" />
                      <button
                        onClick={() => setCoverUrl("")}
                        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="h-32 w-56 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                      <Image className="h-8 w-8 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="space-y-2">
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                    <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                      <Upload className="h-4 w-4 mr-1" /> {uploading ? "Enviando..." : "Upload capa"}
                    </Button>
                    <p className="text-xs text-muted-foreground">Recomendado: 1200×400px, JPG/PNG</p>
                    <div className="flex items-center gap-2">
                      <Input
                        value={coverUrl}
                        onChange={(e) => setCoverUrl(e.target.value)}
                        placeholder="Ou cole uma URL de imagem..."
                        className="text-xs h-8"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Public Info */}
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
                  {editorNote && (
                    <div className="mt-2 rounded-md border p-3 bg-muted/30">
                      <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Preview</p>
                      <div className="prose prose-sm max-w-none text-foreground/80">
                        <ReactMarkdown>{editorNote}</ReactMarkdown>
                      </div>
                    </div>
                  )}
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

            {/* Sections */}
            {SECTION_NAMES.map((name, idx) => {
              const num = idx + 1;
              const aiText = aiSections[`section${num}`]?.narrative || "";
              const editorText = editorSections[`section${num}`] || "";
              const showPreview = sectionPreviews[num];

              return (
                <Card key={num}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Seção {num}: {name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {aiText && (
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                          <ChevronDown className="h-3 w-3" />
                          Texto da IA (original)
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto mt-1">
                            {aiText}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-xs">Texto editado (sobrescreve IA se preenchido)</Label>
                        <div className="flex items-center gap-1">
                          <button onClick={() => insertMarkdown(num, "**", "**")} className="p-1 rounded hover:bg-muted" title="Bold">
                            <Bold className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button onClick={() => insertMarkdown(num, "*", "*")} className="p-1 rounded hover:bg-muted" title="Italic">
                            <Italic className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button onClick={() => insertMarkdown(num, "[", "](url)")} className="p-1 rounded hover:bg-muted" title="Link">
                            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button onClick={() => toggleSectionPreview(num)} className={`p-1 rounded hover:bg-muted ${showPreview ? 'bg-muted' : ''}`} title="Preview">
                            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </div>
                      </div>
                      <Textarea
                        id={`section-editor-${num}`}
                        value={editorText}
                        onChange={(e) => updateSection(num, e.target.value)}
                        rows={4}
                        placeholder="Deixe vazio para usar o texto da IA..."
                      />
                      {showPreview && editorText && (
                        <div className="mt-2 rounded-md border p-3 bg-muted/30">
                          <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Preview Markdown</p>
                          <div className="prose prose-sm max-w-none text-foreground/80">
                            <ReactMarkdown>{editorText}</ReactMarkdown>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="preview">
          <div className="border rounded-xl p-6 bg-background">
            <div className="flex items-center gap-2 mb-4">
              <Badge variant="outline" className="text-xs">Preview — Como o público verá</Badge>
            </div>
            <ReportPreview
              report={report}
              liveEditorSections={editorSections}
              liveTitlePublic={titlePublic}
              liveSubtitlePublic={subtitlePublic}
              liveEditorNote={editorNote}
              liveCoverUrl={coverUrl}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
