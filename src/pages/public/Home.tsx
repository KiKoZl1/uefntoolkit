import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Radar, TrendingUp, Search, Upload, BarChart3, Brain, Zap } from "lucide-react";

const tools = [
  {
    icon: TrendingUp,
    title: "Weekly Reports",
    desc: "Relatórios semanais públicos do ecossistema Discovery: rankings, retenção, categorias e tendências.",
    cta: "Ver Reports",
    link: "/reports",
  },
  {
    icon: Search,
    title: "Island Lookup",
    desc: "Pesquise qualquer ilha pública por código e veja métricas em tempo real direto da API da Epic.",
    cta: "Pesquisar Ilha",
    link: "/auth",
  },
  {
    icon: Upload,
    title: "CSV Analytics",
    desc: "Faça upload do ZIP exportado do Creator Portal e receba análise completa com IA.",
    cta: "Analisar Dados",
    link: "/auth",
  },
];

const features = [
  { icon: BarChart3, title: "Dashboard Visual", desc: "Gráficos, rankings e KPIs visuais — nada de só texto." },
  { icon: Brain, title: "IA Analista", desc: "Narrativas e diagnósticos gerados por IA para cada seção." },
  { icon: Zap, title: "Dados em Tempo Real", desc: "API pública da Epic integrada para métricas live." },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="px-6 pt-20 pb-16 max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-foreground mb-6">
          <Radar className="h-4 w-4 text-primary" />
          Weekly Discovery Intelligence for Fortnite UGC
        </div>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight mb-6">
          O radar do{" "}
          <span className="text-primary">Discovery</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
          Reports semanais, analytics de ilhas e lookup em tempo real — tudo para criadores de Fortnite dominarem o ecossistema.
        </p>
        <div className="flex gap-4 justify-center">
          <Button size="lg" asChild>
            <Link to="/reports">Ver Último Report</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/auth">Criar Conta</Link>
          </Button>
        </div>
      </section>

      {/* Tools */}
      <section className="px-6 py-16 max-w-6xl mx-auto">
        <h2 className="font-display text-3xl font-bold text-center mb-10">3 Ferramentas Poderosas</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {tools.map((t) => (
            <div key={t.title} className="rounded-xl border bg-card p-6 hover:shadow-lg transition-shadow flex flex-col">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 mb-4">
                <t.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-xl mb-2">{t.title}</h3>
              <p className="text-sm text-muted-foreground flex-1">{t.desc}</p>
              <Button className="mt-4 w-full" variant="outline" asChild>
                <Link to={t.link}>{t.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-16 max-w-6xl mx-auto">
        <div className="grid sm:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mx-auto mb-3">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto rounded-2xl bg-primary p-10 text-center text-primary-foreground">
          <h2 className="font-display text-3xl font-bold mb-4">
            Pronto para dominar o Discovery?
          </h2>
          <p className="text-primary-foreground/80 mb-6">
            Crie sua conta e acesse todas as ferramentas gratuitamente.
          </p>
          <Button size="lg" variant="secondary" asChild>
            <Link to="/auth">Criar Conta Grátis</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
