"use client";

import type { ComponentProps } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** shadcn Tabs as category pills: the chosen one is tinted orange. Scrolls sideways on phones. */
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "scroll-x flex gap-1",
        // as a sideways row (below desktop): fade the edges, so a cut-off pill reads as "there's more this way"
        "max-lg:[mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%-36px),transparent)]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium sm:h-10 sm:px-4 sm:text-[15px] whitespace-nowrap text-(--ink) transition outline-none hover:bg-(--sunken)",
        // keyboard focus ring drawn inside the pill: an outer ring was clipped by the scrolling sidebar's edge
        "focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-inset data-[state=active]:bg-brand/12 data-[state=active]:font-semibold data-[state=active]:text-brand data-[state=active]:hover:bg-brand/15",
        "[&_svg]:h-4 [&_svg]:w-4",
        className,
      )}
      {...props}
    />
  );
}
