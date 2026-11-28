"use client";

import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "./ui/dropdown-menu";

const OPTIONS: { value: ThemePref; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Theme menu (Light / Dark / System). The trigger shows the theme on screen right now. Radix gives it the menu-button
 * keyboard pattern (Enter / arrows / Escape). Hidden while a screen pins its own theme (the kitchen is always dark).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { pref, resolved, pinned, setTheme } = useTheme();
  if (pinned) return null;
  const Icon = resolved === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Theme: ${OPTIONS.find((o) => o.value === pref)?.label}`}
        title="Theme"
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-full bg-(--sunken) text-(--ink) transition hover:bg-(--line) data-[state=open]:bg-(--line) sm:h-10 sm:w-10",
          className,
        )}
      >
        <Icon key={resolved} className="h-[18px] w-[18px] animate-pop" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-44">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        {OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => setTheme(o.value)} role="menuitemradio" aria-checked={pref === o.value}>
            <o.icon aria-hidden />
            <span className="flex-1">{o.label}</span>
            {pref === o.value && <Check className="text-brand!" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
