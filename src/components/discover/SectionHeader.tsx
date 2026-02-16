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
    <div className="flex items-start gap-4 mb-6 pt-8 first:pt-0">
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10">
        <Icon className="h-5 w-5 text-primary" />
        <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-[8px] font-bold text-primary">{number}</span>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">
          {t("reportSections.section")} {number}
        </p>
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}
