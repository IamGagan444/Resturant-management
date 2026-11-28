"use client";

import { createElement, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * 3D / AR view of a dish (Google <model-viewer>). The library (~1 MB) is loaded only when a guest opens this,
 * so it never slows down the menu. Guests drag to spin and pinch to zoom; on phones that support it, the
 * "View in your space" button places the dish on their table:
 *   Android → Scene Viewer / WebXR, iPhone → AR Quick Look (model-viewer converts the .glb to USDZ on the fly).
 */
export function Dish3D({ src, alt }: { src: string; alt: string }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    import("@google/model-viewer")
      .then(() => live && setReady(true))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return null; // the photo is still there; 3D is a bonus
  return (
    <div className="relative mb-4 aspect-square w-full overflow-hidden rounded-2xl bg-(--sunken)">
      {ready ? (
        createElement("model-viewer", {
          src,
          alt,
          ar: "",
          "ar-modes": "webxr scene-viewer quick-look",
          "ar-scale": "fixed", // real size on the table, not stretched
          "camera-controls": "",
          "auto-rotate": "",
          "touch-action": "pan-y", // vertical swipes still scroll the sheet
          "shadow-intensity": "1",
          loading: "eager",
          style: { width: "100%", height: "100%", background: "transparent" },
        })
      ) : (
        <span className="absolute inset-0 grid place-items-center">
          <Loader2 className="muted h-7 w-7 animate-spin" aria-hidden />
        </span>
      )}
    </div>
  );
}
