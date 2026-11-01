"use client";

import { useMemo, useState } from "react";
import type { PublicMenu, PublicMenuItem } from "@rms/contracts";
import { isWithinWindow, priceLine, type PricingAddonGroup } from "@rms/domain";
import { useI18n, type Lang } from "@/lib/i18n";
import { Flame, Minus, Plus, Search } from "lucide-react";
import { Button, FoodMark, Sheet, rupees } from "./ui";

export const tName = (item: { name: string; translations: PublicMenuItem["translations"] }, lang: Lang) =>
  (lang !== "en" && item.translations?.[lang]?.name) || item.name;

const tDesc = (item: PublicMenuItem, lang: Lang) => (lang !== "en" && item.translations?.[lang]?.description) || item.description;

export interface AddLine {
  itemId: string;
  variantId: string | null;
  addonIds: string[];
  quantity: number;
  note: string | null;
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

export function Menu({ menu, onAdd }: { menu: PublicMenu; onAdd: (l: AddLine) => Promise<void> }) {
  const { lang, t } = useI18n();
  const [q, setQ] = useState("");
  const [vegOnly, setVegOnly] = useState(false);
  const [bestOnly, setBestOnly] = useState(false);
  const [open, setOpen] = useState<PublicMenuItem | null>(null);
  const sections = useSections(menu, q, vegOnly, bestOnly, lang);

  return (
    <div className="pb-44">
      <div className="sticky top-0 z-20 -mx-4 space-y-2.5 bg-(--bg)/90 px-4 pt-3 pb-3 backdrop-blur-xl md:-mx-6 md:px-6">
        <div className="relative">
          <Search className="muted pointer-events-none absolute top-1/2 left-4 h-4.5 w-4.5 -translate-y-1/2" aria-hidden />
          <input
            type="search"
            placeholder={t("search")}
            aria-label={t("search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
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
          {sections.map((s) => (
            <a
              key={s.category.id}
              href={`#c-${s.category.id}`}
              className="line surface flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium whitespace-nowrap"
            >
              {tName({ name: s.category.name, translations: s.category.translations }, lang)}
            </a>
          ))}
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
          <ul className="divide-y divide-(--line) md:grid md:grid-cols-2 md:gap-4 md:divide-y-0">
            {s.items.map((item) => {
              const available = item.isAvailable && s.isOpen;
              const from = item.variants.length ? Math.min(...item.variants.map((v) => v.price)) : item.price;
              const desc = tDesc(item, lang);
              return (
                <li
                  key={item.id}
                  className={`line flex gap-4 py-5 md:rounded-3xl md:border md:bg-(--surface) md:p-4 md:shadow-soft ${available ? "" : "opacity-55 grayscale-[40%]"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FoodMark type={item.foodType} />
                      {item.isBestseller && (
                        <span className="inline-flex items-center rounded-full bg-(--ink) px-2 py-0.5 text-[11px] font-semibold text-(--bg)">
                          {t("bestseller")}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1.5 text-[17px] leading-snug font-semibold">{tName(item, lang)}</h3>
                    <p className="mt-0.5 flex items-center gap-2 text-[15px] font-semibold">
                      {item.variants.length ? t("fromPrice", { amount: rupees(from) }) : rupees(from)}
                      {item.spiceLevel ? (
                        <span className="flex text-red-500" role="img" aria-label={`Spice level ${item.spiceLevel}`}>
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
                      <img src={item.imageUrl} alt="" loading="lazy" className="h-28 w-32 rounded-xl object-cover" />
                    )}
                    <Button
                      variant="outline"
                      // Uber's floating white pill: reads on a photo and on the plain list alike
                      className={`h-10 min-h-10 w-26 bg-(--surface)! px-1 font-semibold whitespace-nowrap text-(--ink) shadow-[0_2px_8px_rgb(0_0_0/0.16)] ring-1 ring-(--line) ${available ? "text-sm tracking-wide uppercase" : "text-xs"} ${item.imageUrl ? "absolute bottom-0" : ""}`}
                      disabled={!available}
                      onClick={() => setOpen(item)}
                    >
                      {available ? t("add") : t("soldOut")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {open && <ItemSheet item={open} menu={menu} onClose={() => setOpen(null)} onAdd={onAdd} />}
    </div>
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
        {item.isBestseller && <span className="text-xs font-semibold">{t("bestseller")}</span>}
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
              await onAdd({ itemId: item.id, variantId, addonIds, quantity: qty, note: note.trim() || null });
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
