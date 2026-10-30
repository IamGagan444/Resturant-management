"use client";

import { useState } from "react";
import { useGuard } from "@/lib/auth";
import { TopBar } from "@/components/ui";
import { MenuTab } from "@/components/manage/MenuTab";
import { TablesTab } from "@/components/manage/TablesTab";
import { StaffTab } from "@/components/manage/StaffTab";
import { SettingsTab } from "@/components/manage/SettingsTab";
import { DevicesTab } from "@/components/manage/DevicesTab";
import { AuditTab } from "@/components/manage/AuditTab";

const TABS = { menu: "Menu", tables: "Tables & QR", staff: "Staff", settings: "Settings", devices: "Devices", audit: "Audit log" } as const;
type Tab = keyof typeof TABS;

export default function ManagePage() {
  const me = useGuard(["OWNER", "MANAGER"]);
  const [tab, setTab] = useState<Tab>("menu");
  if (!me || me.typ !== "staff") return null;
  return (
    <div className="min-h-dvh">
      <TopBar title={me.hotel.name}>
        <a href="/floor/" className="text-sm font-semibold text-brand underline">
          Live floor
        </a>
        <a href="/reports/" className="text-sm font-semibold text-brand underline">
          Day report
        </a>
        <a href="/kds/" className="muted hidden text-sm underline sm:inline">
          Kitchen
        </a>
        <a href="/waiter/" className="muted hidden text-sm underline sm:inline">
          Floor
        </a>
        <a href="/cashier/" className="muted hidden text-sm underline sm:inline">
          Counter
        </a>
      </TopBar>
      <nav className="line flex gap-1 overflow-x-auto border-b px-2" aria-label="Manage sections">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t}
            className={`tap border-b-2 px-4 font-semibold whitespace-nowrap ${tab === t ? "border-brand text-brand" : "muted border-transparent"}`}
          >
            {TABS[t]}
          </button>
        ))}
      </nav>
      <main className="mx-auto max-w-5xl p-4">
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
