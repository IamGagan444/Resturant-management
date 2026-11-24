"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing, Share } from "lucide-react";
import { clearNotifications, useAlerts, useStayAwake } from "@/lib/push";
import { Button } from "@/components/ui";
import { notify } from "@/components/ui/feedback";

/**
 * Phone alerts for the signed-in person. Loud and in the way until they're on: a waiter or cook without alerts misses
 * orders as soon as the screen locks. `waiting` = anything still to act on (false clears old alerts off the lock screen).
 */
export function AlertsBar({ enabled, waiting }: { enabled: boolean; waiting: boolean }) {
  const { status, turnOn, pause, test } = useAlerts(enabled);
  const [busy, setBusy] = useState(false);
  useStayAwake(enabled);
  useEffect(() => {
    if (enabled && !waiting) void clearNotifications();
  }, [enabled, waiting]);

  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled || status === "loading") return null;
  if (status === "on") {
    return (
      <div className="no-print line flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-fresh">
          <BellRing className="h-4 w-4" aria-hidden />
          Phone alerts on
        </span>
        <span className="ml-auto flex gap-1">
          <button className="h-10 rounded-full px-3 font-semibold hover:bg-(--sunken)" disabled={busy} onClick={run(async () => (await test(), notify.ok("Lock your phone now. A test alert comes in 8 seconds.")))}>
            Test
          </button>
          <button className="h-10 rounded-full px-3 font-semibold hover:bg-(--sunken)" disabled={busy} onClick={run(() => pause(true))}>
            Off duty
          </button>
        </span>
      </div>
    );
  }
  const text = {
    ask: "Turn on phone alerts, or you'll miss orders when the screen is locked or you're in another app.",
    paused: "You're off duty: this phone won't ring when locked.",
    blocked: "Alerts are blocked on this phone. Open the browser's site settings for this page (lock icon by the address, or App info → Notifications), allow notifications, then come back.",
    "needs-install": "On iPhone: tap Share, then Add to Home Screen. Open Restro from the new icon and turn on alerts there.",
    unsupported: "This browser can't ring when the phone is locked. Use Chrome on Android, or an iPhone with iOS 16.4 or newer.",
    error: "Couldn't turn on phone alerts. Check the internet and try again.",
  }[status];
  return (
    <div role="alert" className="no-print flex flex-wrap items-center gap-3 bg-warn px-4 py-2.5 text-sm font-semibold text-warn-ink">
      {status === "needs-install" ? <Share className="h-5 w-5 shrink-0" aria-hidden /> : <BellOff className="h-5 w-5 shrink-0" aria-hidden />}
      <p className="min-w-40 flex-1">{text}</p>
      {(status === "ask" || status === "error") && (
        <Button variant="outline" disabled={busy} onClick={run(turnOn)}>
          Turn on alerts
        </Button>
      )}
      {status === "paused" && (
        <Button variant="outline" disabled={busy} onClick={run(() => pause(false))}>
          Back on duty
        </Button>
      )}
    </div>
  );
}
