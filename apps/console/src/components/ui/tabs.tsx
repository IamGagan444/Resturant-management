"use client";

import type { ComponentProps } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** shadcn Tabs as category pills: the chosen one is tinted orange. Scrolls sideways on phones. */
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("scroll-x flex gap-1", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[15px] font-medium whitespace-nowrap text-(--ink) transition outline-none hover:bg-(--sunken)",
        "focus-visible:ring-2 focus-visible:ring-brand data-[state=active]:bg-brand/12 data-[state=active]:font-semibold data-[state=active]:text-brand data-[state=active]:hover:bg-brand/15",
        "[&_svg]:h-4 [&_svg]:w-4",
        className,
      )}
      {...props}
    />
  );
}
