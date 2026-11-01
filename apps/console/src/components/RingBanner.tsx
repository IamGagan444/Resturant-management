"use client";

import { BellRing, VolumeX } from "lucide-react";
import { soundReady } from "@/lib/ringer";

/** Shown while the ringer rings: why, and a way to quiet it for a minute. */
export function RingBanner({ ringing, label, onSnooze }: { ringing: boolean; label: string; onSnooze: () => void }) {
  if (!ringing) return null;
  return (
    <div role="alert" className="no-print sticky top-16 z-10 flex items-center gap-3 bg-brand px-4 py-2.5 text-white shadow-lift">
      <BellRing className="h-5 w-5 shrink-0 animate-[wiggle_0.5s_ease-in-out_infinite]" aria-hidden />
      <p className="min-w-0 flex-1 text-sm font-semibold">
        {label}
        {!soundReady() && <span className="block text-xs font-medium opacity-85">Tap anywhere once to turn the ring sound on.</span>}
      </p>
      <button onClick={onSnooze} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white/20 px-3 text-sm font-semibold hover:bg-white/30">
        <VolumeX className="h-4 w-4" aria-hidden />
        Mute 1 min
      </button>
    </div>
  );
}
