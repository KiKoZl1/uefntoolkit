import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Radar, TrendingUp, Search, Eye, BarChart3, Brain, Zap, ArrowRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Home() {
  const { t } = useTranslation();

  const tools = [
    { icon: TrendingUp, title: t("home.tool1Title"), desc: t("home.tool1Desc"), cta: t("home.tool1Cta"), link: "/reports" },
    { icon: Search, title: t("home.tool2Title"), desc: t("home.tool2Desc"), cta: t("home.tool2Cta"), link: "/auth" },
    { icon: Eye, title: t("home.tool3Title"), desc: t("home.tool3Desc"), cta: t("home.tool3Cta"), link: "/discover" },
  ];

  const features = [
    { icon: BarChart3, title: t("home.feat1Title"), desc: t("home.feat1Desc") },
    { icon: Brain, title: t("home.feat2Title"), desc: t("home.feat2Desc") },
    { icon: Zap, title: t("home.feat3Title"), desc: t("home.feat3Desc") },
  ];

  return (
    <>
      {/* Hero */}
      <section className="relative px-6 pt-24 pb-20 max-w-5xl mx-auto text-center overflow-hidden">
        {/* Glow effect */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary/8 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm text-primary mb-6">
            <Sparkles className="h-3.5 w-3.5" />
            {t("home.badge")}
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight mb-6">
            {t("home.title")}{" "}
            <span className="text-primary">{t("home.titleHighlight")}</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            {t("home.subtitle")}
          </p>
          <div className="flex gap-3 justify-center">
            <Button size="lg" className="gap-2" asChild>
              <Link to="/discover">
                {t("home.ctaReport")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="border-border/50" asChild>
              <Link to="/auth">{t("home.ctaSignup")}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Tools */}
      <section className="px-6 py-16 max-w-6xl mx-auto">
        <h2 className="font-display text-2xl font-bold text-center mb-10">{t("home.toolsTitle")}</h2>
        <div className="grid md:grid-cols-3 gap-5">
          {tools.map((tool) => (
            <div key={tool.title} className="group rounded-xl border border-border/50 bg-card p-6 hover:border-primary/30 transition-all flex flex-col">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-4 group-hover:bg-primary/20 transition-colors">
                <tool.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-lg mb-2">{tool.title}</h3>
              <p className="text-sm text-muted-foreground flex-1 leading-relaxed">{tool.desc}</p>
              <Button className="mt-5 w-full gap-2" variant="secondary" asChild>
                <Link to={tool.link}>
                  {tool.cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-16 max-w-6xl mx-auto">
        <div className="grid sm:grid-cols-3 gap-8">
          {features.map((f) => (
            <div key={f.title} className="text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mx-auto mb-3">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5 p-10 text-center">
          <h2 className="font-display text-3xl font-bold mb-4">{t("home.ctaSectionTitle")}</h2>
          <p className="text-muted-foreground mb-6">{t("home.ctaSectionDesc")}</p>
          <Button size="lg" className="gap-2" asChild>
            <Link to="/auth">
              {t("home.ctaSectionBtn")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
