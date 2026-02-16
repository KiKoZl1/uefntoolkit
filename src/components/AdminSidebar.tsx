import { Radar, Activity, FileText, LogOut, ArrowLeft, Eye, Brain } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export function AdminSidebar() {
  const { signOut } = useAuth();
  const { t } = useTranslation();

  const items = [
    { title: t("admin.commandCenter"), url: "/admin", icon: Activity, end: true },
    { title: t("nav.reports"), url: "/admin/reports", icon: FileText },
    { title: t("admin.exposure"), url: "/admin/exposure", icon: Eye },
    { title: t("admin.intel"), url: "/admin/intel", icon: Brain },
  ];

  return (
    <Sidebar className="border-r border-sidebar-border">
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary">
          <Radar className="h-5 w-5 text-sidebar-primary-foreground" />
        </div>
        <span className="font-display text-base font-bold text-sidebar-foreground">
          Surprise Radar
        </span>
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider">
            {t("admin.panel")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.end}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-2">
        <LanguageSwitcher />
        <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent" asChild>
          <NavLink to="/app" className="">
            <ArrowLeft className="h-4 w-4 mr-2" /> {t("common.backToApp")}
          </NavLink>
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" /> {t("common.signOut")}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
