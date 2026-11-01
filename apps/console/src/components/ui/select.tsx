"use client";

import type { ComponentProps } from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** shadcn Select, themed. `SelectField` (form.tsx) wraps it for plain value/options use. */
export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-transparent bg-(--field) px-3.5 text-left text-[15px] transition outline-none",
        "focus-visible:border-(--ink) focus-visible:bg-(--surface) focus-visible:shadow-[0_0_0_1px_var(--ink)] data-[state=open]:border-(--ink) data-[state=open]:bg-(--surface)",
        "aria-invalid:border-late data-[placeholder]:text-(--muted) disabled:opacity-50 [&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="muted h-4 w-4 shrink-0" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = "popper", ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={6}
        className={cn(
          "surface line z-[60] max-h-[min(var(--radix-select-content-available-height),20rem)] min-w-[var(--radix-select-trigger-width)] animate-fade-in overflow-hidden rounded-xl border p-1 shadow-lift",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex h-11 cursor-pointer items-center rounded-lg pr-8 pl-3 text-[15px] outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-(--sunken) data-[state=checked]:font-medium",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5 text-(--ink)">
        <Check className="h-4 w-4" aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
