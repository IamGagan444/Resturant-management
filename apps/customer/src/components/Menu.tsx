"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PublicMenu, PublicMenuItem } from "@rms/contracts";
import { isWithinWindow, priceLine, type PricingAddonGroup } from "@rms/domain";
import { useI18n, type Lang } from "@/lib/i18n";
import { prefersReducedMotion, useFly, type FlySource } from "@/lib/motion";
import { Flame, Minus, Package, Plus, Search } from "lucide-react";
import { Button, FoodMark, Sheet, rupees } from "./ui";

export const tName = (item: { name: string; translations: PublicMenuItem["translations"] }, lang: Lang) =>
  (lang !== "en" && item.translations?.[lang]?.name) || item.name;

const tDesc = (item: PublicMenuItem, lang: Lang) => (lang !== "en" && item.translations?.[lang]?.description) || item.description;

/** Walk-in parcel: everything is packed, so there is nothing to choose. */
export const AllParcel = createContext(false);

export interface AddLine {
  itemId: string;
  variantId: string | null;
  addonIds: string[];
  quantity: number;
  note: string | null;
  isParcel: boolean;
}

/** Categories → orderable items, filtered. Shared by the menu and the out-of-stock swap picker. */
function useSections(menu: PublicMenu, q: string, vegOnly: boolean, bestOnly: boolean, lang: Lang) {
  return useMemo(() => {
    const now = new Date();
    const needle = q.trim().toLowerCase();
    return menu.categories
      .map((c) => ({
        category: c,
        isOpen: isWithinWindow(now, menu.hotel.timezone, c.availableFrom, c.availableTo),
        items: menu.items.filter(
          (i) =>
            i.categoryId === c.id &&
            (!vegOnly || i.foodType === "VEG" || i.foodType === "VEGAN") &&
            (!bestOnly || i.isBestseller) &&
            (!needle || i.name.toLowerCase().includes(needle) || tName(i, lang).toLowerCase().includes(needle)),
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [menu, q, vegOnly, bestOnly, lang]);
}

export function Menu({
  menu,
  onAdd,
  onStep,
  inCart,
}: {
  menu: PublicMenu;
  onAdd: (l: AddLine) => Promise<void>;
  /** − / + on a card already in the cart (dishes without sizes or add-ons) */
  onStep: (itemId: string, delta: 1 | -1) => Promise<void>;
  inCart: ReadonlyMap<string, number>;
}) {
  const { lang, t } = useI18n();
  const fly = useFly();
  const [q, setQ] = useState("");
  const [vegOnly, setVegOnly] = useState(false);
  const [bestOnly, setBestOnly] = useState(false);
  const [open, setOpen] = useState<PublicMenuItem | null>(null);
  // one change at a time per dish: the next tap's quantity comes from the server's answer
  const [stepping, setStepping] = useState<ReadonlySet<string>>(() => new Set());
  async function step(itemId: string, delta: 1 | -1) {
    setStepping((x) => new Set(x).add(itemId));
    try {
      await onStep(itemId, delta);
    } finally {
      setStepping((x) => {
        const n = new Set(x);
        n.delete(itemId);
        return n;
      });
    }
  }
  const origin = useRef<FlySource | null>(null);
  const sections = useSections(menu, q, vegOnly, bestOnly, lang);
  const filtering = q.trim() !== "" || vegOnly || bestOnly;
  const featured = useMemo(() => menu.items.filter((i) => i.isBestseller && i.isAvailable && i.imageUrl), [menu]);

  // Which category is on screen: its chip lights up and scrolls into view, so the bar doubles as "you are here".
  const [active, setActive] = useState<string | null>(null);
  const chips = useRef(new Map<string, HTMLAnchorElement>());
  useEffect(() => {
    // the last section whose heading has reached the upper part of the screen is the one being read
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = Math.max(190, window.innerHeight * 0.4); // never above the sticky bar (about 180px tall)
      let current: string | null = sections[0]?.category.id ?? null;
      for (const s of sections) {
        const el = document.getElementById(`c-${s.category.id}`);
        if (el && el.getBoundingClientRect().top <= line) current = s.category.id;
      }
      setActive(current);
    };
    const onScroll = () => (raf ||= requestAnimationFrame(update));
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [sections]);
  useEffect(() => {
    const chip = active ? chips.current.get(active) : null;
    chip?.parentElement?.scrollTo({ left: chip.offsetLeft - 16, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [active]);

  // The bar only casts its edge shadow once content is scrolling under it.
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  function openItem(item: PublicMenuItem, from: HTMLElement) {
    const img = from.closest("li")?.querySelector("img") ?? from;
    origin.current = { src: item.imageUrl, rect: img.getBoundingClientRect() };
    setOpen(item);
  }
  async function add(l: AddLine) {
    await onAdd(l);
    fly(origin.current);
  }
  function jump(e: React.MouseEvent, categoryId: string) {
    e.preventDefault();
    document.getElementById(`c-${categoryId}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setActive(categoryId);
  }

  return (
    <div className="pb-48">
      {!filtering && featured.length >= 2 && (
        <section aria-label={t("bestsellers")} className="mt-4">
          <h2 className="mb-3 font-display text-[22px] font-bold">{t("bestsellers")}</h2>
          <ul className="scroll-x -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 px-4 pb-3 md:-mx-6 md:scroll-px-6 md:px-6">
            {featured.map((item) => {
              const qty = inCart.get(item.id);
              return (
                <li key={item.id} className="w-60 shrink-0 snap-start">
                  <button
                    onClick={(e) => openItem(item, e.currentTarget)}
                    className="group relative block w-full overflow-hidden rounded-3xl text-left shadow-lift transition-transform duration-150 active:scale-[0.98]"
                    aria-label={`${tName(item, lang)}, ${rupees(fromPrice(item))}`}
                  >
                    <img src={item.imageUrl ?? ""} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full bg-(--sunken) object-cover transition-transform duration-500 ease-out group-hover:scale-105" />
                    {/* the text sits on a dark scrim, never directly on the photo */}
                    <span className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" aria-hidden />
                    <span className="absolute top-3 left-3">
                      <FoodMark type={item.foodType} />
                    </span>
                    {qty ? <InCartBadge qty={qty} className="top-2.5 right-2.5" /> : null}
                    <span className="absolute inset-x-3.5 bottom-3 flex items-end justify-between gap-2 text-white">
                      <span className="min-w-0">
                        <span className="block truncate text-[17px] leading-snug font-semibold">{tName(item, lang)}</span>
                        <span className="text-sm font-semibold text-white/85 tabular-nums">{rupees(fromPrice(item))}</span>
                      </span>
                      <span className="grid h-9 shrink-0 place-items-center rounded-full bg-white/90 px-3.5 text-xs font-bold tracking-wide text-[#bd421c] uppercase shadow-[0_2px_8px_rgb(0_0_0/0.25)] backdrop-blur-md">
                        {t("add")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div ref={sentinel} aria-hidden />
      <div
        className={`sticky top-0 z-20 -mx-4 space-y-2.5 bg-(--bg)/75 px-4 pt-3 pb-3 backdrop-blur-lg backdrop-saturate-150 transition-shadow duration-200 md:-mx-6 md:px-6 ${
          stuck ? "shadow-[0_10px_20px_-16px_rgb(0_0_0/0.45)]" : ""
        }`}
      >
        <div className="relative">
          <Search className="muted pointer-events-none absolute top-1/2 left-4 h-4.5 w-4.5 -translate-y-1/2" aria-hidden />
          <input
            type="search"
            placeholder={t("search")}
            aria-label={t("search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            enterKeyHint="search"
            className="tap w-full rounded-full border border-transparent bg-(--sunken) pr-4 pl-11"
          />
        </div>
        <div className="scroll-x -mx-4 flex gap-2 px-4 md:-mx-6 md:px-6">
          <Chip active={vegOnly} onClick={() => setVegOnly((v) => !v)}>
            <FoodMark type="VEG" /> {t("vegOnly")}
          </Chip>
          <Chip active={bestOnly} onClick={() => setBestOnly((v) => !v)}>
            {t("bestsellers")}
          </Chip>
          <span className="line my-1.5 shrink-0 border-l" aria-hidden />
          {sections.map((s) => {
            const on = active === s.category.id;
            return (
              <a
                key={s.category.id}
                ref={(el) => {
                  if (el) chips.current.set(s.category.id, el);
                  else chips.current.delete(s.category.id);
                }}
                href={`#c-${s.category.id}`}
                onClick={(e) => jump(e, s.category.id)}
                aria-current={on ? "location" : undefined}
                className={`flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 ${
                  on ? "border-transparent bg-(--ink) text-(--bg)" : "line surface"
                }`}
              >
                {tName({ name: s.category.name, translations: s.category.translations }, lang)}
              </a>
            );
          })}
        </div>
      </div>

      {sections.length === 0 && (
        <div className="muted flex flex-col items-center gap-3 py-16 text-center">
          <Search className="h-8 w-8" aria-hidden />
          <p>{t("noMatch")}</p>
        </div>
      )}

      {sections.map((s) => (
        <section key={s.category.id} id={`c-${s.category.id}`} className="scroll-mt-36">
          <h2 className="mt-7 mb-1 flex items-baseline gap-2 md:mb-4">
            <span className="font-display text-[22px] font-bold">{tName({ name: s.category.name, translations: s.category.translations }, lang)}</span>
            <span className="muted text-sm">{s.items.length}</span>
            {!s.isOpen && (
              <span className="ml-auto rounded-full bg-(--sunken) px-2.5 py-0.5 text-xs font-semibold">
                {s.category.availableFrom}–{s.category.availableTo}
              </span>
            )}
          </h2>
          <ul className="stagger divide-y divide-(--line) md:grid md:grid-cols-2 md:gap-4 md:divide-y-0 xl:grid-cols-3">
            {s.items.map((item) => {
              const available = item.isAvailable && s.isOpen;
              const desc = tDesc(item, lang);
              const qty = inCart.get(item.id);
              return (
                <li
                  key={item.id}
                  className={`line flex gap-4 py-5 md:rounded-3xl md:border md:bg-(--surface) md:p-4 md:shadow-soft md:transition-[border-color,box-shadow] md:duration-200 md:hover:border-brand/30 md:hover:shadow-lift ${available ? "" : "opacity-55 grayscale-[40%]"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FoodMark type={item.foodType} />
                      {item.isBestseller && (
                        <span className="inline-flex items-center rounded-full bg-brand/12 px-2 py-0.5 text-xs font-semibold text-brand">{t("bestseller")}</span>
                      )}
                    </div>
                    <h3 className="mt-1.5 text-[17px] leading-snug font-semibold">{tName(item, lang)}</h3>
                    <p className="mt-0.5 flex items-center gap-2 text-[15px] font-semibold tabular-nums">
                      {item.variants.length ? t("fromPrice", { amount: rupees(fromPrice(item)) }) : rupees(fromPrice(item))}
                      {item.spiceLevel ? (
                        <span className="flex text-late" role="img" aria-label={`Spice level ${item.spiceLevel}`}>
                          {Array.from({ length: item.spiceLevel }, (_, n) => (
                            <Flame key={n} className="h-3.5 w-3.5 fill-current" aria-hidden />
                          ))}
                        </span>
                      ) : null}
                    </p>
                    {desc && <p className="muted mt-1.5 line-clamp-2 text-sm leading-relaxed">{desc}</p>}
                  </div>
                  <div className={`relative flex w-32 shrink-0 flex-col items-center ${item.imageUrl ? "pb-4" : "justify-center"}`}>
                    {item.imageUrl && (
                      // plain lazy <img>: no next/image runtime, keeps JS small on 4G
                      <img src={item.imageUrl} alt="" loading="lazy" decoding="async" width={128} height={112} className="h-28 w-32 rounded-3xl bg-(--sunken) object-cover shadow-soft" />
                    )}
                    {qty && available && !item.variants.length && !item.addonGroupIds.length ? (
                      <Stepper
                        qty={qty}
                        name={tName(item, lang)}
                        busy={stepping.has(item.id)}
                        onPhoto={Boolean(item.imageUrl)}
                        onStep={(d) => void step(item.id, d)}
                      />
                    ) : (
                      <>
                        {qty ? <InCartBadge qty={qty} className="-top-2 -right-2" /> : null}
                        <Button
                          variant="outline"
                          // glass pill over the photo; a fixed deep orange on near-white keeps 5:1 in both themes
                          className={`h-10 min-h-10 w-26 px-1 font-semibold whitespace-nowrap shadow-[0_4px_14px_-4px_rgb(0_0_0/0.3)] ring-1 ring-black/5 ${
                            item.imageUrl ? "absolute bottom-0 bg-white/90! backdrop-blur-md" : "bg-(--surface)! ring-(--line)"
                          } ${available ? `text-sm font-bold tracking-wide uppercase ${item.imageUrl ? "text-[#bd421c]!" : "text-brand!"}` : "text-xs text-[#5e6773]!"}`}
                          disabled={!available}
                          onClick={(e) => openItem(item, e.currentTarget)}
                        >
                          {available ? t("add") : t("soldOut")}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {open && <ItemSheet item={open} menu={menu} onClose={() => setOpen(null)} onAdd={add} />}
    </div>
  );
}

const fromPrice = (item: PublicMenuItem) => (item.variants.length ? Math.min(...item.variants.map((v) => v.price)) : item.price);

/** − qty + where the ADD button was. Same pill and colours as ADD, so the card doesn't jump. */
function Stepper({ qty, name, busy, onPhoto, onStep }: { qty: number; name: string; busy: boolean; onPhoto: boolean; onStep: (delta: 1 | -1) => void }) {
  const btn = "grid h-10 w-9 shrink-0 place-items-center rounded-full transition active:scale-90 disabled:opacity-40";
  return (
    <div
      className={`flex h-10 w-26 items-center justify-between rounded-full font-bold shadow-[0_4px_14px_-4px_rgb(0_0_0/0.3)] ring-1 ${
        onPhoto ? "absolute bottom-0 bg-white/90 text-[#bd421c] ring-black/5 backdrop-blur-md" : "bg-(--surface) text-brand ring-(--line)"
      }`}
      aria-busy={busy || undefined}
    >
      <button type="button" className={btn} aria-label={`One less ${name}`} disabled={busy} onClick={() => onStep(-1)}>
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <span key={qty} className={`animate-pop text-[15px] tabular-nums ${busy ? "opacity-50" : ""}`} aria-live="polite" aria-label={`${qty} in cart`}>
        {qty}
      </span>
      <button type="button" className={btn} aria-label={`One more ${name}`} disabled={busy} onClick={() => onStep(1)}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/** "2×" on a dish that's already in the table's cart. */
function InCartBadge({ qty, className }: { qty: number; className: string }) {
  return (
    <span key={qty} className={`absolute z-10 grid h-7 min-w-7 animate-pop place-items-center rounded-full bg-brand px-1.5 text-sm font-bold text-brand-ink tabular-nums ring-2 ring-(--bg) ${className}`}>
      {qty}×
    </span>
  );
}

/**
 * Out-of-stock swap: pick any orderable dish (same quantity as the one that ran out),
 * choose its options, done. Two taps for a dish without options.
 */
export function SwapSheet({
  menu,
  title,
  quantity,
  onClose,
  onPick,
}: {
  menu: PublicMenu;
  title: string;
  quantity: number;
  onClose: () => void;
  onPick: (l: AddLine) => Promise<void>;
}) {
  const { lang, t } = useI18n();
  const [q, setQ] = useState("");
  const [item, setItem] = useState<PublicMenuItem | null>(null);
  const sections = useSections(menu, q, false, false, lang);

  if (item) return <ItemSheet item={item} menu={menu} fixedQty={quantity} onClose={() => setItem(null)} onAdd={onPick} />;
  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="relative mb-2">
        <Search className="muted pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2" aria-hidden />
        <input
          type="search"
          placeholder={t("search")}
          aria-label={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="tap w-full rounded-full border border-transparent bg-(--sunken) pr-4 pl-10"
        />
      </div>
      {sections.length === 0 && <p className="muted py-8 text-center">{t("noMatch")}</p>}
      {sections
        .filter((s) => s.isOpen)
        .map((s) => (
          <section key={s.category.id}>
            <h3 className="muted mt-4 text-xs font-bold tracking-wider uppercase">{tName({ name: s.category.name, translations: s.category.translations }, lang)}</h3>
            <ul className="line divide-y divide-(--line)">
              {s.items
                .filter((i) => i.isAvailable)
                .map((i) => (
                  <li key={i.id}>
                    <button className="tap flex w-full items-center justify-between gap-2 text-left" onClick={() => setItem(i)}>
                      <span className="flex items-center gap-2">
                        <FoodMark type={i.foodType} /> {tName(i, lang)}
                      </span>
                      <span className="text-sm font-semibold">{rupees(i.variants.length ? Math.min(...i.variants.map((v) => v.price)) : i.price)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </Sheet>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap transition ${active ? "border-brand bg-brand/10 text-brand" : "line surface"}`}
    >
      {children}
    </button>
  );
}

function ItemSheet({
  item,
  menu,
  fixedQty,
  onClose,
  onAdd,
}: {
  item: PublicMenuItem;
  menu: PublicMenu;
  /** swap mode: quantity is that of the item being replaced, and there's no kitchen note */
  fixedQty?: number;
  onClose: () => void;
  onAdd: (l: AddLine) => Promise<void>;
}) {
  const { lang, t } = useI18n();
  const groups = useMemo(
    () => new Map<string, PricingAddonGroup>(menu.addonGroups.filter((g) => item.addonGroupIds.includes(g.id)).map((g) => [g.id, g])),
    [menu, item],
  );
  const [variantId, setVariantId] = useState<string | null>(item.variants[0]?.id ?? null);
  const [addonIds, setAddonIds] = useState<string[]>(() =>
    // preselect the first free option of required single-choice groups (1 tap less)
    [...groups.values()].flatMap((g) => (g.minSelect === 1 && g.maxSelect === 1 ? (g.addons.find((a) => a.isAvailable && a.price === 0)?.id ?? []) : [])),
  );
  const [qty, setQty] = useState(fixedQty ?? 1);
  const [note, setNote] = useState("");
  const allParcel = useContext(AllParcel);
  const [isParcel, setIsParcel] = useState(allParcel);
  const [busy, setBusy] = useState(false);
  const desc = tDesc(item, lang);

  const priced = priceLine({ ...item, addonGroupIds: item.addonGroupIds }, groups, { variantId, addonIds, quantity: qty });

  function toggle(groupId: string, addonId: string) {
    const g = groups.get(groupId);
    if (!g) return;
    setAddonIds((cur) => {
      if (cur.includes(addonId)) return cur.filter((x) => x !== addonId);
      if (g.maxSelect === 1) return [...cur.filter((x) => !g.addons.some((a) => a.id === x)), addonId];
      return cur.filter((x) => g.addons.some((a) => a.id === x)).length >= g.maxSelect ? cur : [...cur, addonId];
    });
  }

  return (
    <Sheet open onClose={onClose} title={tName(item, lang)}>
      {item.imageUrl && <img src={item.imageUrl} alt="" className="mb-4 aspect-[16/10] w-full rounded-2xl object-cover" />}
      <div className="mb-4 flex items-center gap-2">
        <FoodMark type={item.foodType} />
        {item.isBestseller && <span className="rounded-full bg-brand/12 px-2 py-0.5 text-xs font-semibold text-brand">{t("bestseller")}</span>}
      </div>
      {desc && <p className="muted -mt-2 mb-5 text-sm leading-relaxed">{desc}</p>}

      {item.variants.length > 0 && (
        <fieldset className="mb-5 rounded-2xl bg-(--sunken) p-3">
          <legend className="sr-only">{t("size")}</legend>
          <p className="mb-1 px-1 text-sm font-bold" aria-hidden>
            {t("size")}
          </p>
          {item.variants.map((v) => (
            <label key={v.id} className="tap flex cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-2">
              <span className="flex items-center gap-3 font-medium">
                <input type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariantId(v.id)} className="h-5 w-5 accent-brand" />
                {v.name}
              </span>
              <span>{rupees(v.price)}</span>
            </label>
          ))}
        </fieldset>
      )}

      {[...groups.values()].map((g) => (
        <fieldset key={g.id} className="mb-5 rounded-2xl bg-(--sunken) p-3">
          <legend className="sr-only">{g.name}</legend>
          <p className="mb-1 flex items-baseline justify-between gap-2 px-1" aria-hidden>
            <span className="text-sm font-bold">{g.name}</span>
            <span className="muted text-xs font-medium">
              {g.minSelect > 0 ? t("choose", { n: g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}` }) : t("upTo", { n: g.maxSelect })}
            </span>
          </p>
          {g.addons.map((a) => (
            <label key={a.id} className={`tap flex cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-2 ${a.isAvailable ? "" : "opacity-50"}`}>
              <span className="flex items-center gap-3 font-medium">
                <input
                  type={g.maxSelect === 1 ? "radio" : "checkbox"}
                  name={`g-${g.id}`}
                  disabled={!a.isAvailable}
                  checked={addonIds.includes(a.id)}
                  onChange={() => toggle(g.id, a.id)}
                  className="h-5 w-5 accent-brand"
                />
                {a.name}
              </span>
              <span>{a.price ? `+${rupees(a.price)}` : t("free")}</span>
            </label>
          ))}
        </fieldset>
      ))}

      {fixedQty === undefined && (
        <label className="mb-5 flex flex-col gap-1.5">
          <span className="text-sm font-bold">{t("noteForKitchen")}</span>
          <input
            maxLength={140}
            placeholder={t("notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="tap rounded-lg border border-transparent bg-(--sunken) px-4"
          />
        </label>
      )}

      {fixedQty === undefined && !allParcel && (
        <label className="tap mb-5 flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-(--sunken) px-4 py-2.5">
          <span className="flex items-center gap-3">
            <Package className="h-5 w-5 shrink-0 text-brand" aria-hidden />
            <span>
              <span className="block text-sm font-bold">{t("parcelThis")}</span>
              <span className="muted block text-xs">{t("parcelHint")}</span>
            </span>
          </span>
          <input type="checkbox" checked={isParcel} onChange={(e) => setIsParcel(e.target.checked)} className="h-5 w-5 shrink-0 accent-brand" />
        </label>
      )}

      <div className="surface sticky bottom-0 -mx-5 flex items-center gap-3 px-5 pt-2">
        {fixedQty === undefined ? (
          <div className="flex h-14 items-center rounded-2xl border border-brand/30 bg-brand/5 text-brand">
            <button className="grid h-14 w-12 place-items-center" aria-label="Decrease quantity" onClick={() => setQty((n) => Math.max(1, n - 1))}>
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <span className="w-6 text-center text-lg font-bold tabular-nums" aria-live="polite">
              {qty}
            </span>
            <button className="grid h-14 w-12 place-items-center" aria-label="Increase quantity" onClick={() => setQty((n) => Math.min(50, n + 1))}>
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <span className="font-semibold">× {fixedQty}</span>
        )}
        <Button
          className="h-14 flex-1 text-base"
          disabled={!priced.ok || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd({ itemId: item.id, variantId, addonIds, quantity: qty, note: note.trim() || null, isParcel });
              onClose();
            } catch {
              // caller showed the error; keep the sheet open
            } finally {
              setBusy(false);
            }
          }}
        >
          {priced.ok ? t("addAmount", { amount: rupees(priced.line.lineTotal) }) : t("chooseOptions")}
        </Button>
      </div>
    </Sheet>
  );
}
