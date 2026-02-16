import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Radar, TrendingUp, Search, Upload, BarChart3, Brain, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Home() {
  const { t } = useTranslation();

  const tools = [
    { icon: TrendingUp, title: t("home.tool1Title"), desc: t("home.tool1Desc"), cta: t("home.tool1Cta"), link: "/reports" },
    { icon: Search, title: t("home.tool2Title"), desc: t("home.tool2Desc"), cta: t("home.tool2Cta"), link: "/auth" },
    { icon: Upload, title: t("home.tool3Title"), desc: t("home.tool3Desc"), cta: t("home.tool3Cta"), link: "/auth" },
  ];

  const features = [
    { icon: BarChart3, title: t("home.feat1Title"), desc: t("home.feat1Desc") },
    { icon: Brain, title: t("home.feat2Title"), desc: t("home.feat2Desc") },
    { icon: Zap, title: t("home.feat3Title"), desc: t("home.feat3Desc") },
  ];

  return (
    <>
      <section className="px-6 pt-20 pb-16 max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-foreground mb-6">
          <Radar className="h-4 w-4 text-primary" />
          {t("home.badge")}
        </div>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight mb-6">
          {t("home.title")}{" "}
          <span className="text-primary">{t("home.titleHighlight")}</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
          {t("home.subtitle")}
        </p>
        <div className="flex gap-4 justify-center">
          <Button size="lg" asChild>
            <Link to="/reports">{t("home.ctaReport")}</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/auth">{t("home.ctaSignup")}</Link>
          </Button>
        </div>
      </section>

      <section className="px-6 py-16 max-w-6xl mx-auto">
        <h2 className="font-display text-3xl font-bold text-center mb-10">{t("home.toolsTitle")}</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {tools.map((tool) => (
            <div key={tool.title} className="rounded-xl border bg-card p-6 hover:shadow-lg transition-shadow flex flex-col">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 mb-4">
                <tool.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-xl mb-2">{tool.title}</h3>
              <p className="text-sm text-muted-foreground flex-1">{tool.desc}</p>
              <Button className="mt-4 w-full" variant="outline" asChild>
                <Link to={tool.link}>{tool.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </section>

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

      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto rounded-2xl bg-primary p-10 text-center text-primary-foreground">
          <h2 className="font-display text-3xl font-bold mb-4">{t("home.ctaSectionTitle")}</h2>
          <p className="text-primary-foreground/80 mb-6">{t("home.ctaSectionDesc")}</p>
          <Button size="lg" variant="secondary" asChild>
            <Link to="/auth">{t("home.ctaSectionBtn")}</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
