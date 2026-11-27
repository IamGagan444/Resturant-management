"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDiscard, hasUnsavedChanges } from "@/lib/unsaved";
import { BarChart3, ChefHat, ClipboardList, ConciergeBell, LayoutGrid, Menu, MonitorSmartphone, QrCode, ReceiptText, Settings, Users, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { useGuard } from "@/lib/auth";
import { NavLink, TopBar } from "@/components/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

const isTab = (v: string): v is Tab => v in TABS;

export default function ManagePage() {
  const me = useGuard(["OWNER", "MANAGER"]);
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>("menu");

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
  return (
    <div className="min-h-dvh" onClickCapture={guardLinks}>
      <TopBar title={me.hotel.name} subtitle="Manage">
        {/* tablets and up: every shortcut (text from lg, icons below); phones: one menu */}
        <span className="hidden items-center md:flex lg:hidden">
          {LINKS.filter((l) => l.group === "manage").map((l) => (
            <NavLink key={l.href} href={l.href} icon={l.icon} labelClass="hidden">
              {l.label}
            </NavLink>
          ))}
          <span className="line mx-1.5 h-6 border-l" aria-hidden />
          {LINKS.filter((l) => l.group === "screens").map((l) => (
            <NavLink key={l.href} href={l.href} icon={l.icon} labelClass="hidden">
              {l.label}
            </NavLink>
          ))}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Go to"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:bg-(--sunken) data-[state=open]:bg-(--sunken) md:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Manager</DropdownMenuLabel>
            {LINKS.filter((l) => l.group === "manage").map((l) => (
              <DropdownMenuItem key={l.href} onSelect={() => go(l.href)}>
                <l.icon aria-hidden /> {l.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Staff screens</DropdownMenuLabel>
            {LINKS.filter((l) => l.group === "screens").map((l) => (
              <DropdownMenuItem key={l.href} onSelect={() => go(l.href)}>
                <l.icon aria-hidden /> {l.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </TopBar>
      <Tabs value={tab} onValueChange={(t) => isTab(t) && void setTab(t)} className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* phones and tablets: a sticky row of pills; desktop: a sidebar */}
        <aside className="line sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-10 border-b bg-(--surface) lg:h-[calc(100dvh-4rem)] scroll-thin lg:overflow-y-auto lg:border-r lg:border-b-0 lg:pr-3 lg:pl-4 lg:py-6">
          <p className="muted hidden px-3 pb-2 text-xs font-medium lg:block">Restaurant</p>
          <TabsList className="px-4 py-2.5 sm:px-6 lg:flex-col lg:gap-0.5 lg:p-0" aria-label="Manage sections">
            {(Object.keys(TABS) as Tab[]).map((t) => {
              const Icon = TAB_ICON[t];
              return (
                <TabsTrigger key={t} value={t} className="lg:h-11 lg:w-full lg:justify-start lg:gap-3 lg:px-3.5">
                  <Icon aria-hidden />
                  {TABS[t]}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <div className="hidden lg:block">
            <p className="muted mt-8 px-3 pb-2 text-xs font-medium">Today</p>
            {LINKS.filter((l) => l.group === "manage").map((l) => (
              <SideLink key={l.href} {...l} />
            ))}
            <p className="muted mt-6 px-3 pb-2 text-xs font-medium">Staff screens</p>
            {LINKS.filter((l) => l.group === "screens").map((l) => (
              <SideLink key={l.href} {...l} />
            ))}
          </div>
        </aside>
        <main className="mx-auto w-full max-w-5xl px-3 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          <header key={tab} className="mb-6 animate-rise px-1 sm:mb-8">
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

function SideLink({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <Link href={href} className="group flex h-11 items-center gap-3 rounded-full px-3.5 text-[15px] font-medium transition hover:bg-(--sunken)">
      <Icon className="h-4 w-4 transition group-hover:text-brand" aria-hidden />
      {label}
    </Link>
  );
}
