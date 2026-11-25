"use client";

import { BellRing, Volume2, VolumeX } from "lucide-react";
import { useSound } from "@/lib/sound";
import { toggleSound } from "./SoundToggle";

/** Shown while the ringer rings: why, and a way to quiet it for a minute. */
export function RingBanner({ ringing, label, onSnooze }: { ringing: boolean; label: string; onSnooze: () => void }) {
  const { on, ready } = useSound();
  if (!ringing) return null;
  return (
    <div role="alert" className="no-print sticky top-[4.5rem] z-10 mx-3 my-2 flex animate-rise items-center gap-3 rounded-2xl bg-brand px-4 py-3 text-brand-ink shadow-lift sm:mx-6">
      <BellRing className="h-5 w-5 shrink-0 animate-[wiggle_0.5s_ease-in-out_infinite]" aria-hidden />
      <p className="min-w-0 flex-1 text-sm font-semibold">
        {label}
        {on && !ready && <span className="block text-xs font-medium opacity-85">Tap anywhere once to turn the ring sound on.</span>}
      </p>
      <button onClick={on ? onSnooze : () => toggleSound(true)} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white/20 px-3 text-sm font-semibold hover:bg-white/30">
        {on ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        {on ? "Mute 1 min" : "Sound on"}
      </button>
    </div>
  );
}
