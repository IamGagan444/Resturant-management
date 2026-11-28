"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FloorView } from "@rms/contracts";
import { api } from "@/lib/api";
import { useStaffSocket } from "@/lib/realtime";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDiscard, hasUnsavedChanges } from "@/lib/unsaved";
import {
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  ChefHat,
  ChevronRight,
  ClipboardList,
  ConciergeBell,
  LayoutGrid,
  Menu,
  MonitorPlay,
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
import { signOut, useGuard } from "@/lib/auth";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { NavLink, TopBar } from "@/components/ui";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

/** What each staff screen has waiting right now; the number shows on its tab. */
interface ScreenCount {
  n: number;
  /** spoken / tooltip text, e.g. "4 dishes cooking" */
  label: string;
  /** needs someone now (guest calls, bills asked for): tinted orange instead of grey */
  urgent: boolean;
}
type ScreenCounts = Partial<Record<string, ScreenCount>>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Live counts for the staff-screen tabs, from the same floor view the Live floor screen uses (one request, shared
 * cache under ["floor"]). Kept fresh by the staff socket's events, with a slow poll as a safety net.
 */
function useScreenCounts(enabled: boolean): ScreenCounts {
  const qc = useQueryClient();
  const floor = useQuery({ queryKey: ["floor"], queryFn: () => api<FloorView>("GET", "/v1/s/floor"), enabled, refetchInterval: 30_000 });
  const refetch = useCallback(() => void qc.invalidateQueries({ queryKey: ["floor"] }), [qc]);
  useStaffSocket(enabled, refetch, (s) => {
    for (const ev of [
      "order:placed",
      "order:pending_confirmation",
      "item:status_changed",
      "request:created",
      "request:done",
      "bill:requested",
      "bill:paid",
      "table:status_changed",
      "session:guest_joined",
    ] as const)
      s.on(ev, refetch);
  });
  return useMemo(() => {
    const tables = floor.data?.tables;
    if (!tables) return {};
    let cooking = 0;
    let ready = 0;
    let calls = 0;
    let confirm = 0;
    for (const t of tables) {
      cooking += t.session?.cooking ?? 0;
      ready += t.session?.ready ?? 0;
      calls += t.session?.openRequests ?? 0;
      if (t.session?.pendingConfirm) confirm++;
    }
    const bills = tables.filter((t) => t.status === "BILL_REQUESTED").length;
    const floorLabel = [calls && plural(calls, "guest call", "guest calls"), confirm && plural(confirm, "order to confirm", "orders to confirm"), ready && plural(ready, "dish ready to serve", "dishes ready to serve")]
      .filter(Boolean)
      .join(", ");
    return {
      "/kds/": { n: cooking, label: cooking ? plural(cooking, "dish in the kitchen", "dishes in the kitchen") : "Kitchen is clear", urgent: false },
      "/waiter/": { n: calls + confirm + ready, label: floorLabel || "Nothing waiting on the floor", urgent: calls + confirm > 0 },
      "/cashier/": { n: bills, label: bills ? plural(bills, "bill asked for", "bills asked for") : "No bills waiting", urgent: bills > 0 },
    };
  }, [floor.data]);
}
const isTab = (v: string): v is Tab => v in TABS;

export default function ManagePage() {
  const me = useGuard(["OWNER", "MANAGER"]);
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>("menu");
  const [drawer, setDrawer] = useState(false);
  const counts = useScreenCounts(Boolean(me && me.typ === "staff"));
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
      <TopBar title={me.hotel.name} subtitle="Manage" ownMenu>
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
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:bg-(--sunken) data-[state=open]:bg-(--sunken) md:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{me.hotel.name}</DrawerTitle>
              <DrawerDescription>Live screens, appearance and your account.</DrawerDescription>
            </DrawerHeader>
            <nav className="overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))]" aria-label="Screens">
              <SideLabel>Today</SideLabel>
              {today.map((l) => (
                <SideLink key={l.href} {...l} onClick={jump(l.href)} />
              ))}
              <StaffScreens links={screens} counts={counts} onPick={jump} className="mt-2" />
              <SideLabel className="mt-2">Appearance</SideLabel>
              <ThemeSegmented className="mx-1" />
              <button
                type="button"
                onClick={() => (setDrawer(false), void signOut())}
                className="mt-3 flex h-11 w-full items-center gap-3 rounded-xl px-3.5 text-[15px] font-medium transition hover:bg-(--sunken)"
              >
                <ArrowLeftRight className="muted h-4 w-4" aria-hidden />
                Switch user
              </button>
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
            "line sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-10 border-b bg-(--surface)/90 backdrop-blur-lg lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col lg:border-r lg:border-b-0 lg:bg-(--surface) lg:py-3",
            collapsed ? "lg:px-3" : "lg:pr-3 lg:pl-4",
          )}
        >
          <div className="scroll-thin lg:min-h-0 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto">
            <SideLabel className={cn("hidden lg:block", collapsed && "lg:sr-only")}>Restaurant</SideLabel>
            <TabsList className="px-4 py-2 sm:px-6 sm:py-2.5 lg:flex-col lg:gap-0.5 lg:p-0" aria-label="Manage sections">
              {(Object.keys(TABS) as Tab[]).map((t) => {
                const Icon = TAB_ICON[t];
                return (
                  <TabsTrigger
                    key={t}
                    value={t}
                    title={collapsed ? TABS[t] : undefined}
                    className={cn(
                      "lg:relative lg:h-9 lg:w-full lg:justify-start lg:gap-3 lg:rounded-lg lg:px-3 lg:text-sm",
                      // desktop: a short accent bar marks the open section, besides the tint
                      "lg:before:absolute lg:before:inset-y-2 lg:before:left-0 lg:before:w-[3px] lg:before:scale-y-0 lg:before:rounded-full lg:before:bg-brand lg:before:transition-transform lg:data-[state=active]:before:scale-y-100",
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
              {collapsed ? <Rule /> : <SideLabel className="mt-4">Today</SideLabel>}
              {today.map((l) => (
                <SideLink key={l.href} {...l} iconOnly={collapsed} />
              ))}
              {collapsed ? (
                <>
                  <Rule />
                  <StaffScreensMenu links={screens} counts={counts} onPick={go} />
                </>
              ) : (
                <StaffScreens links={screens} counts={counts} className="mt-4" />
              )}
            </nav>
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "muted mt-2 hidden h-9 shrink-0 items-center gap-3 rounded-lg text-sm font-medium transition hover:bg-(--sunken) hover:text-(--ink) lg:flex",
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
  return <p className={cn("muted px-3 pt-2 pb-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase", className)}>{children}</p>;
}

const Rule = () => <span className="line mx-3 my-3 block border-t" aria-hidden />;

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
      className={cn("group flex h-10 items-center gap-3 rounded-lg text-[15px] font-medium transition hover:bg-(--sunken) lg:h-9 lg:text-sm", iconOnly ? "justify-center" : "px-3")}
    >
      <Icon className="muted h-4 w-4 shrink-0 transition group-hover:text-brand" aria-hidden />
      {!iconOnly && <span className="flex-1 truncate">{label}</span>}
      {!iconOnly && <ArrowUpRight className="muted h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" aria-hidden />}
    </Link>
  );
}

type ScreenLink = { href: string; label: string; icon: LucideIcon };

/**
 * Kitchen / Floor / Counter as one compact segmented strip (icon over label) instead of three rows: they're the
 * same kind of thing — a shared screen staff run — so they read as one group and take a third of the height.
 */
function StaffScreens({
  links,
  counts,
  onPick,
  className,
}: {
  links: ScreenLink[];
  counts: ScreenCounts;
  onPick?: (href: string) => (e: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <SideLabel>Staff screens</SideLabel>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-(--sunken) p-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={onPick?.(l.href)}
            title={counts[l.href] ? `${l.label}: ${counts[l.href]!.label}` : `Open the ${l.label.toLowerCase()} screen`}
            aria-label={counts[l.href] ? `${l.label}, ${counts[l.href]!.label}` : l.label}
            className="group relative flex h-13 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition hover:bg-(--surface) hover:shadow-soft"
          >
            <l.icon className="muted h-4 w-4 transition group-hover:text-brand" aria-hidden />
            {l.label}
            <CountBadge count={counts[l.href]} className="absolute top-1 right-1.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Folded sidebar: the three staff screens behind one icon. */
function StaffScreensMenu({ links, counts, onPick }: { links: ScreenLink[]; counts: ScreenCounts; onPick: (href: string) => void }) {
  const urgent = links.some((l) => counts[l.href]?.urgent);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Staff screens"
        title="Staff screens"
        className="relative flex h-9 w-full items-center justify-center rounded-lg transition hover:bg-(--sunken) data-[state=open]:bg-(--sunken)"
      >
        <MonitorPlay className="muted h-4 w-4" aria-hidden />
        {/* folded: a dot when something needs someone now */}
        {urgent && <span className="absolute top-1.5 right-3 h-2 w-2 rounded-full bg-brand ring-2 ring-(--surface)" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="min-w-44">
        <DropdownMenuLabel>Staff screens</DropdownMenuLabel>
        {links.map((l) => (
          <DropdownMenuItem key={l.href} onSelect={() => onPick(l.href)} title={counts[l.href]?.label}>
            <l.icon aria-hidden />
            <span className="flex-1">{l.label}</span>
            <CountBadge count={counts[l.href]} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Small count on a staff-screen tab: orange when someone is needed now, grey for work in progress, hidden at 0. */
function CountBadge({ count, className }: { count?: ScreenCount; className?: string }) {
  if (!count?.n) return null;
  return (
    <span
      key={count.n}
      aria-hidden
      className={cn(
        "grid h-4 min-w-4 animate-pop place-items-center rounded-full px-1 text-[10px] leading-none font-bold tabular-nums",
        count.urgent ? "bg-brand text-brand-ink" : "bg-(--line) text-(--ink)",
        className,
      )}
    >
      {count.n > 99 ? "99+" : count.n}
    </span>
  );
}
