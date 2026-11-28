"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDiscard, hasUnsavedChanges } from "@/lib/unsaved";
import {
  ArrowUpRight,
  BarChart3,
  ChefHat,
  ChevronRight,
  ClipboardList,
  ConciergeBell,
  LayoutGrid,
  Menu,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  QrCode,
  ReceiptText,
  Settings,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { useGuard } from "@/lib/auth";
import { NavLink, TopBar } from "@/components/ui";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MenuTab } from "@/components/manage/MenuTab";
import { TablesTab } from "@/components/manage/TablesTab";
import { StaffTab } from "@/components/manage/StaffTab";
import { SettingsTab } from "@/components/manage/SettingsTab";
import { DevicesTab } from "@/components/manage/DevicesTab";
import { AuditTab } from "@/components/manage/AuditTab";

const TABS = { menu: "Menu", tables: "Tables & QR", staff: "Staff", settings: "Settings", devices: "Devices", audit: "Audit log" } as const;
type Tab = keyof typeof TABS;
const TAB_HINT: Record<Tab, string> = {
  menu: "Dishes, prices, photos and add-ons your guests see.",
  tables: "Your tables, floors and the QR code on each table.",
  staff: "Who works here, what they can do, and their PINs.",
  settings: "Restaurant details, taxes and what goes on the bill.",
  devices: "Kitchen screens, waiter phones and counters that staff sign in on.",
  audit: "Who changed what, and when.",
};
const TAB_ICON: Record<Tab, LucideIcon> = { menu: UtensilsCrossed, tables: QrCode, staff: Users, settings: Settings, devices: MonitorSmartphone, audit: ClipboardList };

const LINKS: { href: string; label: string; icon: LucideIcon; group: "manage" | "screens" }[] = [
  { href: "/floor/", label: "Live floor", icon: LayoutGrid, group: "manage" },
  { href: "/reports/", label: "Day report", icon: BarChart3, group: "manage" },
  { href: "/kds/", label: "Kitchen", icon: ChefHat, group: "screens" },
  { href: "/waiter/", label: "Floor", icon: ConciergeBell, group: "screens" },
  { href: "/cashier/", label: "Counter", icon: ReceiptText, group: "screens" },
];

const SIDEBAR_KEY = "rms.sidebar";
const isTab = (v: string): v is Tab => v in TABS;

export default function ManagePage() {
  const me = useGuard(["OWNER", "MANAGER"]);
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>("menu");
  const [drawer, setDrawer] = useState(false);
  // desktop sidebar folded to icons; remembered on this device
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* storage blocked: start open */
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  // The open section lives in the URL (#staff), so a reload or the back button returns to it.
  useEffect(() => {
    const fromHash = () => {
      const h = location.hash.slice(1);
      if (isTab(h)) setTabState(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  // the chosen pill scrolls into view in the sideways row (phones, narrow windows), also after a reload on #audit
  useEffect(() => {
    document.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [tab, me]);

  /** Switching sections unmounts the old one: ask before dropping unsaved edits there. */
  async function setTab(next: Tab) {
    if (next === tab || !(await confirmDiscard())) return;
    setTabState(next);
    history.replaceState(null, "", `#${next}`);
  }

  /** Same question for every in-app link on this screen (sidebar, top bar). Closing the tab is covered by beforeunload. */
  function guardLinks(e: MouseEvent<HTMLDivElement>) {
    const a = (e.target as HTMLElement).closest("a[href]");
    const href = a?.getAttribute("href");
    if (!href?.startsWith("/") || !hasUnsavedChanges() || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    void confirmDiscard().then((ok) => ok && router.push(href));
  }
  const go = (href: string) => void confirmDiscard().then((ok) => ok && router.push(href));

  if (!me || me.typ !== "staff") return null;
  const today = LINKS.filter((l) => l.group === "manage");
  const screens = LINKS.filter((l) => l.group === "screens");
  const jump = (href: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setDrawer(false);
    go(href);
  };
  return (
    <div className="min-h-dvh" onClickCapture={guardLinks}>
      <TopBar title={me.hotel.name} subtitle="Manage">
        {/* tablets: every shortcut as an icon; desktop has them in the sidebar; phones: the drawer */}
        <span className="hidden items-center md:flex lg:hidden">
          {today.map((l) => (
            <NavLink key={l.href} href={l.href} icon={l.icon} labelClass="hidden">
              {l.label}
            </NavLink>
          ))}
          <span className="line mx-1.5 h-6 border-l" aria-hidden />
          {screens.map((l) => (
            <NavLink key={l.href} href={l.href} icon={l.icon} labelClass="hidden">
              {l.label}
            </NavLink>
          ))}
        </span>
        <Drawer open={drawer} onOpenChange={setDrawer}>
          <DrawerTrigger
            aria-label="Go to"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition hover:bg-(--sunken) data-[state=open]:bg-(--sunken) sm:h-10 sm:w-10 md:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{me.hotel.name}</DrawerTitle>
              <DrawerDescription>Jump to a live screen.</DrawerDescription>
            </DrawerHeader>
            <nav className="overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))]" aria-label="Screens">
              <SideLabel>Today</SideLabel>
              {today.map((l) => (
                <SideLink key={l.href} {...l} onClick={jump(l.href)} />
              ))}
              <SideLabel className="mt-2">Staff screens</SideLabel>
              {screens.map((l) => (
                <SideLink key={l.href} {...l} onClick={jump(l.href)} />
              ))}
            </nav>
          </DrawerContent>
        </Drawer>
      </TopBar>
      <Tabs
        value={tab}
        onValueChange={(t) => isTab(t) && void setTab(t)}
        className={cn(
          "transition-[grid-template-columns] duration-200 ease-out lg:grid",
          collapsed ? "lg:grid-cols-[4.75rem_minmax(0,1fr)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]",
        )}
      >
        {/* phones and tablets: a sticky row of pills; desktop: a sidebar that folds to an icon rail */}
        <aside
          className={cn(
            "line sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-10 border-b bg-(--surface)/90 backdrop-blur-lg lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col lg:border-r lg:border-b-0 lg:bg-(--surface) lg:py-5",
            collapsed ? "lg:px-3" : "lg:pr-3 lg:pl-4",
          )}
        >
          <div className="scroll-thin lg:min-h-0 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto">
            <SideLabel className={cn("hidden lg:block", collapsed && "lg:sr-only")}>Restaurant</SideLabel>
            <TabsList className="px-4 py-2.5 sm:px-6 lg:flex-col lg:gap-0.5 lg:p-0" aria-label="Manage sections">
              {(Object.keys(TABS) as Tab[]).map((t) => {
                const Icon = TAB_ICON[t];
                return (
                  <TabsTrigger
                    key={t}
                    value={t}
                    title={collapsed ? TABS[t] : undefined}
                    className={cn(
                      "lg:relative lg:h-11 lg:w-full lg:justify-start lg:gap-3 lg:rounded-xl lg:px-3.5",
                      // desktop: a short accent bar marks the open section, besides the tint
                      "lg:before:absolute lg:before:inset-y-2.5 lg:before:left-0 lg:before:w-[3px] lg:before:scale-y-0 lg:before:rounded-full lg:before:bg-brand lg:before:transition-transform lg:data-[state=active]:before:scale-y-100",
                      collapsed && "lg:justify-center lg:px-0",
                    )}
                  >
                    <Icon aria-hidden />
                    <span className={cn(collapsed && "lg:sr-only")}>{TABS[t]}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
            <nav className="hidden lg:block" aria-label="Screens">
              {collapsed ? <Rule /> : <SideLabel className="mt-7">Today</SideLabel>}
              {today.map((l) => (
                <SideLink key={l.href} {...l} iconOnly={collapsed} />
              ))}
              {collapsed ? <Rule /> : <SideLabel className="mt-6">Staff screens</SideLabel>}
              {screens.map((l) => (
                <SideLink key={l.href} {...l} iconOnly={collapsed} />
              ))}
            </nav>
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "muted mt-3 hidden h-10 shrink-0 items-center gap-3 rounded-xl text-sm font-medium transition hover:bg-(--sunken) hover:text-(--ink) lg:flex",
              collapsed ? "justify-center" : "px-3.5",
            )}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
            {!collapsed && "Collapse"}
          </button>
        </aside>
        <main className="mx-auto w-full max-w-6xl px-3 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-9">
          <header key={tab} className="mb-6 animate-rise px-1 sm:mb-8">
            <nav aria-label="Breadcrumb" className="muted mb-2 hidden items-center gap-1.5 text-[13px] font-medium sm:flex">
              <span>Manage</span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              <span className="text-(--ink)" aria-current="page">
                {TABS[tab]}
              </span>
            </nav>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{TABS[tab]}</h2>
            <p className="muted mt-1.5 text-[15px]">{TAB_HINT[tab]}</p>
          </header>
          <TabsContent value="menu">
            <MenuTab />
          </TabsContent>
          <TabsContent value="tables">
            <TablesTab />
          </TabsContent>
          <TabsContent value="staff">
            <StaffTab />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab />
          </TabsContent>
          <TabsContent value="devices">
            <DevicesTab />
          </TabsContent>
          <TabsContent value="audit">
            <AuditTab />
          </TabsContent>
        </main>
      </Tabs>
    </div>
  );
}

function SideLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("muted px-3.5 pt-3 pb-2 text-[11px] font-semibold tracking-[0.08em] uppercase", className)}>{children}</p>;
}

const Rule = () => <span className="line mx-3 my-4 block border-t" aria-hidden />;

function SideLink({
  href,
  label,
  icon: Icon,
  iconOnly = false,
  onClick,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  iconOnly?: boolean;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={iconOnly ? label : undefined}
      aria-label={iconOnly ? label : undefined}
      className={cn("group flex h-11 items-center gap-3 rounded-xl text-[15px] font-medium transition hover:bg-(--sunken)", iconOnly ? "justify-center" : "px-3.5")}
    >
      <Icon className="muted h-4 w-4 shrink-0 transition group-hover:text-brand" aria-hidden />
      {!iconOnly && <span className="flex-1 truncate">{label}</span>}
      {!iconOnly && <ArrowUpRight className="muted h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" aria-hidden />}
    </Link>
  );
}
