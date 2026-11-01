import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** shadcn Skeleton: a pulsing placeholder in the shape of what is loading. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-(--sunken)", className)} {...props} />;
}

/** Rows of a list (avatar/icon + two lines + action). */
export function ListSkeleton({ rows = 4, cols = 1, className }: { rows?: number; cols?: 1 | 2; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("grid gap-2", cols === 2 && "md:grid-cols-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="line flex items-center gap-3 rounded-xl border p-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** A card with a heading and some lines. */
export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("surface rounded-2xl p-5 sm:p-6", className)}>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="mt-2 h-3.5 w-1/2" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

/** Row of number tiles (dashboards, reports). */
export function StatsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="surface rounded-2xl p-5">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-3 h-7 w-2/3" />
        </div>
      ))}
    </div>
  );
}
