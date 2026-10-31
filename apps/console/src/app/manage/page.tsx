"use client";

import { useState } from "react";
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
const TAB_ICON: Record<Tab, LucideIcon> = { menu: UtensilsCrossed, tables: QrCode, staff: Users, settings: Settings, devices: MonitorSmartphone, audit: ClipboardList };

const LINKS: { href: string; label: string; icon: LucideIcon; group: "manage" | "screens" }[] = [
  { href: "/floor/", label: "Live floor", icon: LayoutGrid, group: "manage" },
  { href: "/reports/", label: "Day report", icon: BarChart3, group: "manage" },
  { href: "/kds/", label: "Kitchen", icon: ChefHat, group: "screens" },
  { href: "/waiter/", label: "Floor", icon: ConciergeBell, group: "screens" },
  { href: "/cashier/", label: "Counter", icon: ReceiptText, group: "screens" },
];

export default function ManagePage() {
  const me = useGuard(["OWNER", "MANAGER"]);
  const [tab, setTab] = useState<Tab>("menu");
  if (!me || me.typ !== "staff") return null;
  return (
    <div className="min-h-dvh">
      <TopBar title={me.hotel.name} subtitle="Manage">
        {/* wide screens: every shortcut; phones: one menu so the header never overflows */}
        <span className="hidden items-center sm:flex">
          {LINKS.filter((l) => l.group === "manage").map((l) => (
            <NavLink key={l.href} href={l.href} icon={l.icon}>
              {l.label}
            </NavLink>
          ))}
        </span>
        <span className="line mx-1 hidden h-6 border-l lg:block" aria-hidden />
        <span className="hidden items-center lg:flex">
          {LINKS.filter((l) => l.group === "screens").map((l) => (
            <NavLink key={l.href} href={l.href} icon={l.icon}>
              {l.label}
            </NavLink>
          ))}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Go to"
            className="muted grid h-10 w-10 shrink-0 place-items-center rounded-xl transition hover:bg-(--sunken) hover:text-(--ink) data-[state=open]:bg-(--sunken) lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Manager</DropdownMenuLabel>
            {LINKS.filter((l) => l.group === "manage").map((l) => (
              <DropdownMenuItem key={l.href} onSelect={() => (location.href = l.href)}>
                <l.icon aria-hidden /> {l.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Staff screens</DropdownMenuLabel>
            {LINKS.filter((l) => l.group === "screens").map((l) => (
              <DropdownMenuItem key={l.href} onSelect={() => (location.href = l.href)}>
                <l.icon aria-hidden /> {l.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </TopBar>
      <Tabs value={tab} onValueChange={(t) => setTab(t as Tab)}>
        <div className="line sticky top-16 z-10 border-b bg-(--bg)/85 backdrop-blur-xl">
          <TabsList className="mx-auto max-w-6xl px-3 py-2 sm:px-6" aria-label="Manage sections">
            {(Object.keys(TABS) as Tab[]).map((t) => {
              const Icon = TAB_ICON[t];
              return (
                <TabsTrigger key={t} value={t}>
                  <Icon aria-hidden />
                  {TABS[t]}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
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
