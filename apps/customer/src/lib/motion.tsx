"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

/*
 * Guest-app motion helpers. No animation library: the browser's own Web Animations API (element.animate) and
 * CSS transitions cover these, and the menu's first load stays as small as it was. (Motion was tried; even its
 * lazy setup put ~19 kB on the first load.)
 */

export const prefersReducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── Fly to cart: the dish photo arcs from where it was tapped into the cart button ──

export interface FlySource {
  src: string | null;
  rect: DOMRect;
}
export const FlyContext = createContext<(from: FlySource | null) => void>(() => {});
export const useFly = () => useContext(FlyContext);

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Animate a photo from `from` into `target`, then give the target a small bump. WAAPI only: no library needed. */
export function flyTo(from: FlySource | null, target: HTMLElement | null) {
  if (!target) return;
  const bump = () => target.animate([{ transform: "scale(1)" }, { transform: "scale(1.05)" }, { transform: "scale(1)" }], { duration: 260, easing: EASE_OUT });
  if (!from?.src || prefersReducedMotion()) return void bump();
  const to = target.getBoundingClientRect();
  const size = 56;
  const img = document.createElement("img");
  img.src = from.src;
  img.alt = "";
  Object.assign(img.style, {
    position: "fixed",
    left: `${from.rect.left + from.rect.width / 2 - size / 2}px`,
    top: `${from.rect.top + from.rect.height / 2 - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "16px",
    objectFit: "cover",
    zIndex: "60",
    pointerEvents: "none",
    boxShadow: "0 10px 24px -8px rgb(0 0 0 / 0.45)",
  });
  document.body.appendChild(img);
  const dx = to.left + 28 - (from.rect.left + from.rect.width / 2);
  const dy = to.top + to.height / 2 - (from.rect.top + from.rect.height / 2);
  const lift = Math.min(160, Math.abs(dy) * 0.35 + 60); // the arc: up first, then down into the cart
  const flight = img.animate(
    [
      { transform: "translate(0, 0) scale(1.15)", opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(0.9)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0.6 },
    ],
    { duration: 620, easing: "cubic-bezier(0.45, 0, 0.25, 1)" },
  );
  flight.onfinish = () => {
    img.remove();
    bump();
  };
  flight.oncancel = () => img.remove();
}

/**
 * A rupee total that counts to its new value instead of jumping (tabular figures, so nothing shifts).
 * `step`: in-between values are rounded to it (100 paise = whole rupees, so no ₹554.69 mid-count); the end is exact.
 */
export function useCountUp(value: number, ms = 450, step = 1): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || prefersReducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - p) ** 3;
      const v = p < 1 ? Math.round((start + (value - start) * eased) / step) * step : value;
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, step]);
  return shown;
}
