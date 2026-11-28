/**
 * Sideways rows (`.scroll-x`: tab pills, chips) hide their scrollbar, so with a mouse the only way along them was
 * Shift+wheel. While the pointer is over such a row and it can still move that way, the wheel scrolls it sideways;
 * at either end the wheel goes back to scrolling the page. Touch and trackpads already scroll sideways natively.
 */
let started = false;

export function startWheelScrollX() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.shiftKey || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // already sideways, or zoom
      const row = (e.target as Element | null)?.closest?.<HTMLElement>(".scroll-x");
      if (!row || row.scrollWidth <= row.clientWidth) return;
      const max = row.scrollWidth - row.clientWidth;
      if ((e.deltaY < 0 && row.scrollLeft <= 0) || (e.deltaY > 0 && row.scrollLeft >= max - 1)) return;
      e.preventDefault();
      row.scrollLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY; // lines → px on Firefox
    },
    { passive: false },
  );
}
