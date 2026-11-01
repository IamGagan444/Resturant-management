"use client";

import type { ComponentProps, ReactNode } from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/** shadcn DropdownMenu, themed. */
export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({ className, align = "end", ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn("surface line z-[60] min-w-52 animate-fade-in rounded-xl border p-1.5 shadow-lift", className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, destructive = false, ...props }: ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-[15px] font-medium outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-(--sunken) [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
        destructive ? "text-late data-[highlighted]:bg-late/10" : "[&_svg]:text-(--muted)",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("muted px-3 pt-2 pb-1 text-xs font-semibold", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("my-1 h-px bg-(--line)", className)} {...props} />;
}

/** The usual "⋯" button that opens a row's actions. */
export function RowActions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="muted grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:bg-(--sunken) hover:text-(--ink) data-[state=open]:bg-(--sunken)"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
