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
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
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
