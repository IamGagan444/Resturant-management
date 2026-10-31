"use client";

import type { ComponentProps } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "@/lib/utils";

/** shadcn Drawer (vaul): a bottom sheet you can swipe down to close. */
export const Drawer = ({ shouldScaleBackground = false, ...props }: ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
);
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;

export function DrawerContent({ className, children, ...props }: ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
      <DrawerPrimitive.Content
        className={cn("surface fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-3xl shadow-lift outline-none", className)}
        {...props}
      >
        <div className="mx-auto mt-2.5 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-(--line)" aria-hidden />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
}

export function DrawerHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("line border-b px-5 pt-2 pb-3", className)} {...props} />;
}

export function DrawerTitle({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Title>) {
  return <DrawerPrimitive.Title className={cn("text-lg font-bold tracking-tight", className)} {...props} />;
}

export function DrawerDescription({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Description>) {
  return <DrawerPrimitive.Description className={cn("muted mt-0.5 text-sm", className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("line flex flex-wrap items-center gap-2 border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)} {...props} />;
}
