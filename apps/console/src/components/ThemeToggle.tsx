"use client";

import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "./ui/dropdown-menu";

export const THEME_OPTIONS: { value: ThemePref; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Theme menu (Light / Dark / System). The trigger shows the theme on screen right now. Radix gives it the menu-button
 * keyboard pattern (Enter / arrows / Escape). Hidden while a screen pins its own theme (the kitchen is always dark).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { pref, resolved, pinned } = useTheme();
  if (pinned) return null;
  const Icon = resolved === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Theme: ${THEME_OPTIONS.find((o) => o.value === pref)?.label}`}
        title="Theme"
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-(--sunken) text-(--ink) transition hover:bg-(--line) data-[state=open]:bg-(--line)",
          className,
        )}
      >
        <Icon key={resolved} className="h-[18px] w-[18px] animate-pop" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-44">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <ThemeMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Light / Dark / System as menu items, for any dropdown (the theme menu, the phone header menu). */
export function ThemeMenuItems() {
  const { pref, setTheme } = useTheme();
  return THEME_OPTIONS.map((o) => (
    <DropdownMenuItem key={o.value} onSelect={() => setTheme(o.value)} role="menuitemradio" aria-checked={pref === o.value}>
      <o.icon aria-hidden />
      <span className="flex-1">{o.label}</span>
      {pref === o.value && <Check className="text-brand!" aria-hidden />}
    </DropdownMenuItem>
  ));
}

/** Light / Dark / System as a compact segmented control (drawers and panels). */
export function ThemeSegmented({ className }: { className?: string }) {
  const { pref, pinned, setTheme } = useTheme();
  if (pinned) return null;
  return (
    <div role="radiogroup" aria-label="Appearance" className={cn("grid grid-cols-3 gap-1 rounded-xl bg-(--sunken) p-1", className)}>
      {THEME_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => setTheme(o.value)}
          className={cn(
            "flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition",
            pref === o.value ? "bg-(--surface) text-(--ink) shadow-soft" : "text-(--muted) hover:text-(--ink)",
          )}
        >
          <o.icon className="h-3.5 w-3.5" aria-hidden />
          {o.label}
        </button>
      ))}
    </div>
  );
}
