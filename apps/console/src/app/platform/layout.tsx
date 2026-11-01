"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Building2, KeySquare, LayoutDashboard, Rocket, type LucideIcon } from "lucide-react";
import { useGuard } from "@/lib/auth";
import { TopBar } from "@/components/ui";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: LucideIcon; hint: string }[] = [
  { href: "/platform/", label: "Dashboard", icon: LayoutDashboard, hint: "How the platform is doing" },
  { href: "/platform/restaurants/", label: "Restaurants", icon: Building2, hint: "Edit, suspend, delete" },
  { href: "/platform/onboard/", label: "Onboarding", icon: Rocket, hint: "Add a new restaurant" },
  { href: "/platform/sessions/", label: "Sessions", icon: KeySquare, hint: "Who is signed in" },
];

/** Super admin shell: sidebar on large screens, a tab strip on phones. Guards every /platform page. */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  const me = useGuard("platform");
  const path = usePathname();
  if (!me) return null;
  const active = (href: string) => (href === "/platform/" ? path === "/platform" || path === "/platform/" : path.startsWith(href.replace(/\/$/, "")));

  return (
    <div className="min-h-dvh">
      <TopBar title="Platform" subtitle={`Super admin · ${me.name}`} />
      <nav className="line scroll-x sticky top-16 z-10 flex gap-1 border-b bg-(--bg)/85 px-3 py-2 backdrop-blur-xl lg:hidden" aria-label="Platform sections">
        {NAV.map((n) => (
          <a
            key={n.href}
            href={n.href}
            aria-current={active(n.href) ? "page" : undefined}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold whitespace-nowrap transition",
              active(n.href) ? "bg-(--surface) text-brand shadow-soft ring-1 ring-(--line)" : "text-(--muted) hover:bg-(--sunken) hover:text-(--ink)",
            )}
          >
            <n.icon className="h-4 w-4" aria-hidden />
            {n.label}
          </a>
        ))}
      </nav>
      <div className="mx-auto flex max-w-7xl gap-8 px-3 py-5 sm:px-6 sm:py-8">
        <aside className="hidden w-60 shrink-0 lg:block">
          <nav className="sticky top-24 space-y-1" aria-label="Platform sections">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 transition",
                  active(n.href) ? "bg-(--surface) shadow-soft ring-1 ring-(--line)" : "hover:bg-(--sunken)",
                )}
              >
                <span className={cn("grid h-9 w-9 place-items-center rounded-lg", active(n.href) ? "bg-brand text-brand-ink" : "bg-(--sunken) text-(--muted)")}>
                  <n.icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-semibold", active(n.href) && "text-brand")}>{n.label}</span>
                  <span className="muted block truncate text-xs">{n.hint}</span>
                </span>
              </a>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

