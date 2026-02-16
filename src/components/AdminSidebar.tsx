import { Radar, Activity, FileText, LogOut, ArrowLeft, Eye, Brain, Layers, Sparkles, Home } from "lucide-react";
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
    { title: "Panels", url: "/admin/panels", icon: Layers },
  ];

  const platform = [
    { title: t("nav.discover"), url: "/discover", icon: Sparkles },
    { title: "Home", url: "/", icon: Home },
  ];

  const linkClass = "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors";
  const activeClass = "bg-primary/10 text-primary font-medium";

  return (
    <Sidebar className="border-r border-sidebar-border">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Radar className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-display text-base font-bold text-sidebar-foreground tracking-tight">
          Surprise<span className="text-primary">Radar</span>
        </span>
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 px-3">
            {t("admin.panel")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end={item.end} className={linkClass} activeClassName={activeClass}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 px-3">
            Platform
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {platform.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} className={linkClass} activeClassName={activeClass}>
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

      <SidebarFooter className="p-4 space-y-1.5">
        <LanguageSwitcher />
        <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/50 hover:text-primary hover:bg-primary/10" asChild>
          <NavLink to="/app" className="">
            <ArrowLeft className="h-4 w-4 mr-2" /> {t("common.backToApp")}
          </NavLink>
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" /> {t("common.signOut")}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
