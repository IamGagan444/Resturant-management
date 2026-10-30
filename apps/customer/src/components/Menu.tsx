"use client";

import { useMemo, useState } from "react";
import type { PublicMenu, PublicMenuItem } from "@rms/contracts";
import { isWithinWindow, priceLine, type PricingAddonGroup } from "@rms/domain";
import { useI18n, type Lang } from "@/lib/i18n";
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
    <div className="pb-40">
      <div className="sticky top-0 z-20 -mx-4 space-y-2 bg-(--bg) px-4 pt-2 pb-3">
        <input
          type="search"
          placeholder={t("search")}
          aria-label={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="tap surface line w-full rounded-xl border px-4"
        />
        <div className="flex gap-2 overflow-x-auto">
          <Chip active={vegOnly} onClick={() => setVegOnly((v) => !v)}>
            <FoodMark type="VEG" /> {t("vegOnly")}
          </Chip>
          <Chip active={bestOnly} onClick={() => setBestOnly((v) => !v)}>
            {t("bestsellers")}
          </Chip>
          {sections.map((s) => (
            <a key={s.category.id} href={`#c-${s.category.id}`} className="line shrink-0 rounded-full border px-3 py-2 text-sm whitespace-nowrap">
              {tName({ name: s.category.name, translations: s.category.translations }, lang)}
            </a>
          ))}
        </div>
      </div>

      {sections.length === 0 && <p className="muted py-12 text-center">{t("noMatch")}</p>}

      {sections.map((s) => (
        <section key={s.category.id} id={`c-${s.category.id}`} className="scroll-mt-32">
          <h2 className="mt-6 mb-2 text-lg font-bold">
            {tName({ name: s.category.name, translations: s.category.translations }, lang)}
            {!s.isOpen && (
              <span className="muted ml-2 text-sm font-normal">
                {s.category.availableFrom}–{s.category.availableTo}
              </span>
            )}
          </h2>
          <ul className="line divide-y divide-(--line)">
            {s.items.map((item) => {
              const available = item.isAvailable && s.isOpen;
              const from = item.variants.length ? Math.min(...item.variants.map((v) => v.price)) : item.price;
              const desc = tDesc(item, lang);
              return (
                <li key={item.id} className={`flex gap-3 py-4 ${available ? "" : "opacity-50"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FoodMark type={item.foodType} />
                      {item.isBestseller && <span className="text-xs font-semibold text-brand">{t("bestseller")}</span>}
                    </div>
                    <h3 className="mt-1 font-semibold">{tName(item, lang)}</h3>
                    <p className="text-sm">
                      {item.variants.length ? t("fromPrice", { amount: rupees(from) }) : rupees(from)}
                      {item.spiceLevel ? <span aria-label={`Spice level ${item.spiceLevel}`}> · {"🌶".repeat(item.spiceLevel)}</span> : null}
                    </p>
                    {desc && <p className="muted mt-1 line-clamp-2 text-sm">{desc}</p>}
                  </div>
                  <div className="flex w-28 shrink-0 flex-col items-center justify-end gap-2">
                    {item.imageUrl && (
                      // plain lazy <img>: no next/image runtime, keeps JS small on 4G
                      <img src={item.imageUrl} alt="" loading="lazy" className="h-24 w-28 rounded-xl object-cover" />
                    )}
                    <Button variant="outline" className="w-full text-brand" disabled={!available} onClick={() => setOpen(item)}>
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
      <input
        type="search"
        placeholder={t("search")}
        aria-label={t("search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="tap surface line mb-2 w-full rounded-xl border px-4"
      />
      {sections.length === 0 && <p className="muted py-8 text-center">{t("noMatch")}</p>}
      {sections
        .filter((s) => s.isOpen)
        .map((s) => (
          <section key={s.category.id}>
            <h3 className="muted mt-3 text-sm font-semibold">{tName({ name: s.category.name, translations: s.category.translations }, lang)}</h3>
            <ul className="line divide-y divide-(--line)">
              {s.items
                .filter((i) => i.isAvailable)
                .map((i) => (
                  <li key={i.id}>
                    <button className="tap flex w-full items-center justify-between gap-2 text-left" onClick={() => setItem(i)}>
                      <span className="flex items-center gap-2">
                        <FoodMark type={i.foodType} /> {tName(i, lang)}
                      </span>
                      <span className="muted text-sm">{rupees(i.variants.length ? Math.min(...i.variants.map((v) => v.price)) : i.price)}</span>
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
      className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-2 text-sm whitespace-nowrap ${active ? "border-brand bg-brand/10 text-brand" : "line"}`}
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
      {desc && <p className="muted mb-4 text-sm">{desc}</p>}

      {item.variants.length > 0 && (
        <fieldset className="mb-4">
          <legend className="mb-2 font-semibold">{t("size")}</legend>
          {item.variants.map((v) => (
            <label key={v.id} className="tap flex items-center justify-between gap-3 border-b line py-2">
              <span className="flex items-center gap-3">
                <input type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariantId(v.id)} className="h-5 w-5 accent-brand" />
                {v.name}
              </span>
              <span>{rupees(v.price)}</span>
            </label>
          ))}
        </fieldset>
      )}

      {[...groups.values()].map((g) => (
        <fieldset key={g.id} className="mb-4">
          <legend className="mb-2 font-semibold">
            {g.name}{" "}
            <span className="muted text-sm font-normal">
              {g.minSelect > 0 ? t("choose", { n: g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}` }) : t("upTo", { n: g.maxSelect })}
            </span>
          </legend>
          {g.addons.map((a) => (
            <label key={a.id} className={`tap flex items-center justify-between gap-3 border-b line py-2 ${a.isAvailable ? "" : "opacity-50"}`}>
              <span className="flex items-center gap-3">
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
        <label className="mb-4 flex flex-col gap-1">
          <span className="font-semibold">{t("noteForKitchen")}</span>
          <input
            maxLength={140}
            placeholder={t("notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="tap surface line rounded-xl border px-4"
          />
        </label>
      )}

      <div className="flex items-center gap-3">
        {fixedQty === undefined ? (
          <div className="line flex items-center rounded-xl border">
            <button className="tap text-xl" aria-label="Decrease quantity" onClick={() => setQty((n) => Math.max(1, n - 1))}>
              −
            </button>
            <span className="w-8 text-center font-semibold" aria-live="polite">
              {qty}
            </span>
            <button className="tap text-xl" aria-label="Increase quantity" onClick={() => setQty((n) => Math.min(50, n + 1))}>
              +
            </button>
          </div>
        ) : (
          <span className="font-semibold">× {fixedQty}</span>
        )}
        <Button
          className="flex-1 text-lg"
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
