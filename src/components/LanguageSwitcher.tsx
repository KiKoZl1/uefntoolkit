import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const LANGUAGES = [
  { code: "en", label: "English", short: "US" },
  { code: "pt-BR", label: "Portuguese", short: "BR" },
] as const;

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  const current = LANGUAGES.find((l) => l.code === i18n.language) || LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" aria-label={t("nav.language")}>
          <Globe className="h-4 w-4" />
          <span className="text-xs font-semibold tracking-wide">{current.short}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[120]">
        {LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => i18n.changeLanguage(lang.code)}
            className={i18n.language === lang.code ? "bg-accent" : ""}
          >
            <span className="mr-2 text-[10px] font-semibold text-muted-foreground">{lang.short}</span>
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
