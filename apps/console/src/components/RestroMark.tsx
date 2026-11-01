/**
 * The Restro mark (fork + cloche + growth chart), drawn as SVG so it stays sharp at any size and
 * weighs ~1 KB instead of a 650 KB PNG. Navy parts use `currentColor`, so the mark follows the
 * text colour (navy on cream, cream on dark); the cloche and dot use the brand orange.
 * `animated` plays a one-off intro: the lid lifts, the trend line draws, the dot pops.
 */
export function RestroMark({ className = "h-9 w-9", animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${animated ? "mark-animated" : ""} ${className}`}
    >
      <g stroke="currentColor" strokeWidth="3.4">
        <path d="M30.5 22.5A36 36 0 0 1 87.6 45" />
        <path d="M11.5 13v11.5a4.5 4.5 0 0 0 9 0V13M16 13v11M16 29v20.5A36 36 0 0 0 48 86" />
        <path d="M31 46.5h42" />
        <path className="mark-trend" pathLength={1} d="M40 74l12.4-7.5M58 65h9l11-10" strokeWidth="2.6" />
      </g>
      <path d="M35 47.5h34l-3 5.2a3 3 0 0 1-2.6 1.6H40.6a3 3 0 0 1-2.6-1.6z" fill="currentColor" />
      <g className="mark-lid" fill="var(--color-brand)">
        <path d="M33 42.5a19 17.5 0 0 1 38 0z" />
        <rect x="48.5" y="20.5" width="7" height="3.6" rx="1.8" />
        <rect x="51" y="23" width="2" height="2.5" />
        <path d="M39.5 37.5q2.5-6 8-8" fill="none" stroke="#fff" strokeWidth="1.5" opacity=".85" />
      </g>
      <circle className="mark-dot" cx="86" cy="54" r="4.2" fill="var(--color-brand)" />
      <circle cx="40" cy="74" r="4" fill="currentColor" />
      <circle cx="55" cy="65" r="3" stroke="currentColor" strokeWidth="2.4" />
      <g fill="currentColor">
        <path d="M54 76.5h5.5v9.3l-5.5.4z" />
        <path d="M62.5 72h5.5v11.6l-5.5 1.6z" />
        <path d="M71 66l5.5-4.4v11.4a28 28 0 0 1-5.5 7.6z" />
      </g>
    </svg>
  );
}

/** Mark + "restro" wordmark, for sign-in screens and headers. */
export function RestroLogo({ className = "", markClass = "h-10 w-10", animated = false }: { className?: string; markClass?: string; animated?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <RestroMark className={markClass} animated={animated} />
      <span className="font-display text-2xl leading-none font-bold tracking-tight">restro</span>
    </span>
  );
}
