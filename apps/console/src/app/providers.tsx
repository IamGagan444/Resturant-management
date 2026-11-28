"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NetworkError } from "@/lib/api";
import { onModeChange, startNet } from "@/lib/net";
import { onFlushed, startOutbox } from "@/lib/outbox";
import { startWheelScrollX } from "@/lib/scrollx";
import { ConfirmHost, Toaster } from "@/components/ui/feedback";

function makeClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // no point hammering a dead connection; net.ts re-probes and we refetch on reconnect
        retry: (n, e) => !(e instanceof NetworkError) && n < 1,
        refetchOnWindowFocus: true,
        staleTime: 5_000,
      },
    },
  });
  // Restaurant setup (menu, staff, tables, settings) and platform lists change only through these screens, and every
  // edit invalidates them. With the 5 s default, flipping between Manage tabs refetched each tab on every visit.
  // Live screens (board, kitchen, bills, floor) keep the short default: sockets and intervals drive them.
  client.setQueryDefaults(["admin"], { staleTime: 5 * 60_000 });
  client.setQueryDefaults(["p"], { staleTime: 60_000 });
  return client;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);

  useEffect(() => {
    startNet();
    startOutbox();
    startWheelScrollX();
    // switching cloud ↔ hub ↔ offline, or queued actions landing: every screen reloads its data
    const offMode = onModeChange(() => void client.invalidateQueries());
    const offFlush = onFlushed(() => void client.invalidateQueries());
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => {
      offMode();
      offFlush();
    };
  }, [client]);

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
      <ConfirmHost />
    </QueryClientProvider>
  );
}
