"use client";

import { Volume2, VolumeX } from "lucide-react";
import { chime } from "@/lib/realtime";
import { setSoundEnabled, useSound } from "@/lib/sound";

/** Sound on/off. The choice stays on this device until it is changed; turning it on plays a chime to prove it works. */
export function toggleSound(on: boolean) {
  setSoundEnabled(on);
  if (on) setTimeout(() => chime(), 150); // resuming audio takes a moment
}

export function SoundToggle() {
  const { on } = useSound();
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label="Sound"
      title={on ? "Sound is on" : "Sound is off"}
      onClick={() => toggleSound(!on)}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full -outline-offset-2 transition hover:bg-(--sunken) ${on ? "text-fresh" : "text-late"}`}
    >
      {on ? <Volume2 className="h-5 w-5" aria-hidden /> : <VolumeX className="h-5 w-5" aria-hidden />}
    </button>
  );
}
