"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Moon, Send, Share, Volume2, VolumeX } from "lucide-react";
import { useSound } from "@/lib/sound";
import { toggleSound } from "./SoundToggle";
import { clearNotifications, useAlerts, useStayAwake } from "@/lib/push";
import { Button } from "@/components/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { notify } from "@/components/ui/feedback";

type Alerts = ReturnType<typeof useAlerts>;

const sendTest = async (alerts: Alerts) => {
  await alerts.test();
  notify.ok("Lock your phone now. A test alert comes in 8 seconds.");
};

/**
 * Phone alerts for the signed-in person. Loud and in the way until they're on: a waiter or cook without alerts misses
 * orders as soon as the screen locks. `waiting` = anything still to act on (false clears old alerts off the lock screen).
 * `shared` = the page keeps the alerts state and shows an <AlertsMenu>, so this bar stays away while everything is fine.
 */
export function AlertsBar({ enabled, waiting, shared }: { enabled: boolean; waiting: boolean; shared?: Alerts }) {
  const own = useAlerts(enabled && !shared);
  const alerts = shared ?? own;
  const { status, turnOn, pause } = alerts;
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
  if (status === "on" && shared) return null;
  if (status === "on") {
    return (
      <div className="no-print line flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-fresh">
          <BellRing className="h-4 w-4" aria-hidden />
          Phone alerts on
        </span>
        <span className="ml-auto flex gap-1">
          <button className="h-10 rounded-full px-3 font-semibold hover:bg-(--sunken)" disabled={busy} onClick={run(() => sendTest(alerts))}>
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

/** One round bell for the top bar: alert state at a glance (dot), everything else tucked inside. */
export function AlertsMenu({ alerts }: { alerts: Alerts }) {
  const { on: soundOn } = useSound();
  const on = alerts.status === "on";
  const paused = alerts.status === "paused";
  const act = (fn: () => Promise<unknown>) => () => void fn().catch((e: unknown) => notify.error(e));
  const label = on ? "Phone alerts on" : paused ? "Off duty" : "Phone alerts off";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Alerts and sound: ${label}${soundOn ? "" : ", sound off"}`}
        title="Alerts and sound"
        className="relative grid h-11 w-11 -outline-offset-2 shrink-0 place-items-center rounded-full transition hover:bg-(--sunken) data-[state=open]:bg-(--sunken)"
      >
        {paused ? <BellOff className="h-5 w-5" aria-hidden /> : <Bell className="h-5 w-5" aria-hidden />}
        <span className={`absolute top-2.5 right-2.5 h-2 w-2 rounded-full ring-2 ring-(--bg) ${on && soundOn ? "bg-fresh" : "bg-warn"}`} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-60 rounded-2xl">
        <DropdownMenuLabel className={on ? "text-fresh" : ""}>{label}</DropdownMenuLabel>
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={soundOn}
          onSelect={(e) => {
            e.preventDefault(); // stay open so the switch is seen to move
            toggleSound(!soundOn);
          }}
        >
          {soundOn ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
          <span className="flex-1">Sound</span>
          <span className={`h-6 w-10 rounded-full p-0.5 transition-colors ${soundOn ? "bg-fresh" : "bg-(--line)"}`} aria-hidden>
            <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${soundOn ? "translate-x-4" : ""}`} />
          </span>
        </DropdownMenuItem>
        {on && (
          <DropdownMenuItem onSelect={act(() => sendTest(alerts))}>
            <Send aria-hidden />
            Test phone alert
          </DropdownMenuItem>
        )}
        {(on || paused) && <DropdownMenuSeparator />}
        {(on || paused) && (
          <DropdownMenuItem onSelect={act(() => alerts.pause(on))}>
            {on ? <Moon aria-hidden /> : <BellRing aria-hidden />}
            {on ? "Go off duty" : "Back on duty"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
