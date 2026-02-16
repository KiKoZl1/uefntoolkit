import { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SectionHeaderProps {
  icon: LucideIcon;
  number: number;
  title: string;
  description: string;
}

export function SectionHeader({ icon: Icon, number, title, description }: SectionHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-4 mb-6 pt-8 first:pt-0">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-mono text-primary/60 uppercase tracking-widest">
            {t("reportSections.section")} {number}
          </span>
        </div>
        <h2 className="font-display text-xl font-bold leading-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}
