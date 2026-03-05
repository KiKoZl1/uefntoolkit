import { Link } from "react-router-dom";
import { Camera, Layers3, Wand2, ImagePlus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TOOLS = [
  {
    to: "/app/thumb-tools/generate",
    title: "Generate",
    description: "Geração principal de thumbnails com Nano Banana.",
    icon: ImagePlus,
  },
  {
    to: "/app/thumb-tools/edit-studio",
    title: "Edit Studio",
    description: "Mask edit, character replace e custom character em uma tool.",
    icon: Wand2,
  },
  {
    to: "/app/thumb-tools/camera-control",
    title: "Camera Control",
    description: "Controle de ângulo com presets e parâmetros contínuos.",
    icon: Camera,
  },
  {
    to: "/app/thumb-tools/layer-decomposition",
    title: "Layer Decomposition",
    description: "Separação por camadas com preview, toggle e download.",
    icon: Layers3,
  },
];

export default function ThumbToolsHub() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-bold">Thumb Tools</h1>
        <p className="text-sm text-muted-foreground">Conjunto completo de geração e pós-produção para thumbnails.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link key={tool.to} to={tool.to}>
            <Card className="h-full border-border/60 bg-card/30 transition hover:border-primary/40 hover:bg-card/50">
              <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                <div className="rounded-lg border border-primary/30 bg-primary/10 p-2 text-primary">
                  <tool.icon className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-lg">{tool.title}</CardTitle>
                  <CardDescription>{tool.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Abrir ferramenta</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
