"use client";

import { useState } from "react";
import { useGuard } from "@/lib/auth";
import { BarChart3, ChefHat, ClipboardList, ConciergeBell, LayoutGrid, MonitorSmartphone, QrCode, ReceiptText, Settings, Users, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { NavLink, TopBar } from "@/components/ui";
import { MenuTab } from "@/components/manage/MenuTab";
import { TablesTab } from "@/components/manage/TablesTab";
import { StaffTab } from "@/components/manage/StaffTab";
import { SettingsTab } from "@/components/manage/SettingsTab";
import { DevicesTab } from "@/components/manage/DevicesTab";
import { AuditTab } from "@/components/manage/AuditTab";

const TABS = { menu: "Menu", tables: "Tables & QR", staff: "Staff", settings: "Settings", devices: "Devices", audit: "Audit log" } as const;
type Tab = keyof typeof TABS;
const TAB_ICON: Record<Tab, LucideIcon> = { menu: UtensilsCrossed, tables: QrCode, staff: Users, settings: Settings, devices: MonitorSmartphone, audit: ClipboardList };

export default function ManagePage() {
  const me = useGuard(["OWNER", "MANAGER"]);
  const [tab, setTab] = useState<Tab>("menu");
  if (!me || me.typ !== "staff") return null;
  return (
    <div className="min-h-dvh">
      <TopBar title={me.hotel.name} subtitle="Manage">
        <NavLink href="/floor/" icon={LayoutGrid}>
          Live floor
        </NavLink>
        <NavLink href="/reports/" icon={BarChart3}>
          Day report
        </NavLink>
        <span className="line mx-1 hidden h-6 border-l lg:block" aria-hidden />
        <span className="hidden items-center lg:flex">
          <NavLink href="/kds/" icon={ChefHat}>
            Kitchen
          </NavLink>
          <NavLink href="/waiter/" icon={ConciergeBell}>
            Floor
          </NavLink>
          <NavLink href="/cashier/" icon={ReceiptText}>
            Counter
          </NavLink>
        </span>
      </TopBar>
      <div className="line sticky top-16 z-10 border-b bg-(--bg)/85 backdrop-blur-xl">
        <nav className="scroll-x mx-auto flex max-w-6xl gap-1 px-3 py-2 sm:px-6" aria-label="Manage sections">
          {(Object.keys(TABS) as Tab[]).map((t) => {
            const Icon = TAB_ICON[t];
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-current={tab === t}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold whitespace-nowrap transition ${
                  tab === t ? "surface text-brand shadow-soft ring-1 ring-(--line)" : "muted hover:bg-(--sunken) hover:text-(--ink)"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {TABS[t]}
              </button>
            );
          })}
        </nav>
      </div>
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        {tab === "menu" && <MenuTab />}
        {tab === "tables" && <TablesTab />}
        {tab === "staff" && <StaffTab />}
        {tab === "settings" && <SettingsTab />}
        {tab === "devices" && <DevicesTab />}
        {tab === "audit" && <AuditTab />}
      </main>
    </div>
  );
}
