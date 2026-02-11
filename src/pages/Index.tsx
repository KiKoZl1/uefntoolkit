import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BarChart3, Upload, Brain, TrendingUp, Shield, Zap } from "lucide-react";

const features = [
  { icon: Upload, title: "Upload Simples", desc: "Arraste o ZIP exportado da Epic e pronto. Processamento 100% no browser." },
  { icon: BarChart3, title: "Dashboard Completo", desc: "7 tabs com aquisição, engajamento, retenção, surveys e plano de ação." },
  { icon: Brain, title: "IA Analista", desc: "Um consultor de game design que conhece seus dados e responde suas perguntas." },
  { icon: TrendingUp, title: "Diagnóstico Automático", desc: "Detecta gargalos e gera recomendações priorizadas com evidências." },
  { icon: Shield, title: "Dados Seguros", desc: "Seus dados ficam no seu browser. Nada é compartilhado sem sua permissão." },
  { icon: Zap, title: "Comparações", desc: "Compare uploads diferentes e veja a evolução da sua ilha ao longo do tempo." },
];

export default function Index() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <BarChart3 className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-lg font-bold">Island Analytics</span>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" asChild>
            <Link to="/auth">Entrar</Link>
          </Button>
          <Button asChild>
            <Link to="/auth">Começar Grátis</Link>
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-20 pb-16 max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm text-muted-foreground mb-6">
          <Brain className="h-4 w-4 text-primary" />
          Powered by AI Game Design Analyst
        </div>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight mb-6">
          Transforme dados da Epic em{" "}
          <span className="text-primary">decisões de game design</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
          Faça upload do export do painel da Epic Games e receba um relatório analítico completo com diagnóstico de IA, 
          plano de ação priorizado e um analista virtual para tirar suas dúvidas.
        </p>
        <div className="flex gap-4 justify-center">
          <Button size="lg" asChild>
            <Link to="/auth">Começar Agora</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/auth">Ver Demo</Link>
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <h2 className="font-display text-3xl font-bold text-center mb-12">
          Tudo que você precisa para otimizar sua ilha
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6 hover:shadow-md transition-shadow">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-4">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto rounded-2xl bg-primary p-10 text-center text-primary-foreground">
          <h2 className="font-display text-3xl font-bold mb-4">
            Pronto para entender sua ilha?
          </h2>
          <p className="text-primary-foreground/80 mb-6">
            Crie sua conta gratuita e faça seu primeiro upload em menos de 2 minutos.
          </p>
          <Button size="lg" variant="secondary" asChild>
            <Link to="/auth">Criar Conta Grátis</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t text-center text-sm text-muted-foreground">
        © 2026 Island Analytics. Feito para criadores de ilhas Fortnite.
      </footer>
    </div>
  );
}
