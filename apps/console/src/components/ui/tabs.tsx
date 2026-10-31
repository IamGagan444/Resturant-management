"use client";

import type { ComponentProps } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** shadcn Tabs, themed as a pill switcher that scrolls sideways on phones. */
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("scroll-x flex gap-1", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-(--muted) text-sm font-semibold whitespace-nowrap transition outline-none hover:bg-(--sunken) hover:text-(--ink)",
        "focus-visible:ring-2 focus-visible:ring-brand/40 data-[state=active]:bg-(--surface) data-[state=active]:text-brand data-[state=active]:shadow-soft data-[state=active]:ring-1 data-[state=active]:ring-(--line)",
        "[&_svg]:h-4 [&_svg]:w-4",
        className,
      )}
      {...props}
    />
  );
}
