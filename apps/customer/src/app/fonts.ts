import localFont from "next/font/local";

/**
 * Inter (text) and Figtree (headings), self-hosted: the woff2 files live in src/fonts, so builds never call Google
 * Fonts (next/font/google fetched them at build time and crashed when Google's response changed — Docker builds failed).
 * Same files Google serves, split the same way: "latin" for everyday text, "latin-ext" for ₹ and accented names.
 * The -ext faces come first in the font stack (globals.css) and carry no fallback of their own: their unicode-range
 * means the browser only uses them for those characters and moves on to the latin face (+ its metric-matched fallback).
 */
// Unicode ranges are Google Fonts' own latin / latin-ext splits. next/font needs them written inline (no constants).
export const inter = localFont({
  src: "../fonts/inter-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const interExt = localFont({
  src: "../fonts/inter-latin-ext.woff2",
  weight: "100 900",
  variable: "--font-inter-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
export const figtree = localFont({
  src: "../fonts/figtree-latin.woff2",
  weight: "600 800",
  variable: "--font-figtree",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const figtreeExt = localFont({
  src: "../fonts/figtree-latin-ext.woff2",
  weight: "600 800",
  variable: "--font-figtree-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});

export const fontVariables = [inter, interExt, figtree, figtreeExt].map((f) => f.variable).join(" ");
