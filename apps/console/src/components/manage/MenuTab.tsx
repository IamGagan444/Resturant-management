"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AddonGroupInput, CategoryInput, MenuItemInput, type FoodType } from "@rms/contracts";
import { Camera, ImageIcon, Loader2, Plus, Trash2, X } from "lucide-react";
import { api, rupees, toPaise } from "@/lib/api";
import { shrinkImage } from "@/lib/image";
import { Badge, Button, Card, CardHeader, EmptyState, Field, FormError, SelectField, orNull, useForm } from "@/components/ui";
import { Loadable, confirm, notify } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";
import { CardSkeleton, ListSkeleton, Skeleton } from "@/components/ui/skeleton";

interface Category { id: string; name: string; availableFrom: string | null; availableTo: string | null; isActive: boolean }
interface Station { id: string; name: string }
interface Tax { id: string; name: string; rateBps: number }
interface AddonGroup { id: string; name: string; minSelect: number; maxSelect: number; addons: { id: string; name: string; price: number }[] }
interface Item {
  id: string;
  categoryId: string;
  stationId: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  foodType: FoodType;
  spiceLevel: number | null;
  prepTimeMin: number;
  isBestseller: boolean;
  isAvailable: boolean;
  variants: { id: string; name: string; price: number }[];
  taxIds: string[];
  addonGroupIds: string[];
}

const FOOD_TYPES = [
  { value: "VEG", label: "Veg" },
  { value: "NON_VEG", label: "Non-veg" },
  { value: "EGG", label: "Egg" },
  { value: "VEGAN", label: "Vegan" },
];
const SPICE = [
  { value: "0", label: "Not spicy" },
  { value: "1", label: "Mild" },
  { value: "2", label: "Medium" },
  { value: "3", label: "Hot" },
];

/** Checkbox as a tappable chip; highlighted while checked. */
const CHIP = "line flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium transition has-checked:border-brand/50 has-checked:bg-brand/8";

/** Money field text → paise; blank stays undefined so the schema says "Required". */
const paiseOrBlank = (s: string) => (s.trim() === "" ? undefined : toPaise(s));

function useAdmin<T>(key: string) {
  return useQuery({ queryKey: ["admin", key], queryFn: () => api<T>("GET", `/v1/admin/${key}`) });
}

export function MenuTab() {
  const qc = useQueryClient();
  const categories = useAdmin<Category[]>("categories");
  const items = useAdmin<Item[]>("items");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });

  const cat = useForm({
    initial: { name: "" },
    schema: CategoryInput,
    build: (v) => ({ name: v.name.trim(), sortOrder: (categories.data?.length ?? 0) + 1 }),
  });
  const addCategory = cat.submit(async (body) => {
    await api("POST", "/v1/admin/categories", body);
    cat.reset();
    notify.ok(`Category “${body.name}” added`);
    refresh();
  });

  async function removeCategory(c: Category) {
    const count = items.data?.filter((i) => i.categoryId === c.id).length ?? 0;
    const ok = await confirm({
      title: `Delete “${c.name}”?`,
      description: count ? `Its ${count} dish${count > 1 ? "es" : ""} will be removed from the menu too.` : "Guests won't see this section any more.",
      confirmLabel: "Delete category",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api("DELETE", `/v1/admin/categories/${c.id}`);
      notify.ok(`“${c.name}” deleted`);
      refresh();
    } catch (e) {
      notify.error(e);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Categories" hint="Sections of your menu, in the order guests see them." />
        <Loadable
          query={categories}
          skeleton={
            <div className="mb-4 flex flex-wrap gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-24 rounded-full" />
              ))}
            </div>
          }
        >
          {(list) => (
            <div className="mb-4 flex flex-wrap gap-2">
              {list.length === 0 && <p className="muted text-sm">No categories yet. Start with one like “Starters”.</p>}
              {list.map((c) => (
                <span key={c.id} className="line inline-flex h-9 items-center gap-2 rounded-full border bg-(--sunken) pr-1.5 pl-3.5 text-sm font-medium">
                  {c.name}
                  {c.availableFrom && (
                    <span className="muted text-xs">
                      {c.availableFrom}–{c.availableTo}
                    </span>
                  )}
                  <button
                    aria-label={`Delete ${c.name}`}
                    className="muted grid h-6 w-6 place-items-center rounded-full hover:bg-late/15 hover:text-late"
                    onClick={() => void removeCategory(c)}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Loadable>
        <form onSubmit={addCategory} className="flex items-start gap-2" noValidate>
          <Field label="New category" required error={cat.error("name")} className="flex-1">
            <input {...cat.text("name")} placeholder="e.g. Starters" maxLength={60} />
          </Field>
          <Button type="submit" className="mt-6.5" disabled={cat.busy}>
            <Plus className="h-4 w-4" aria-hidden />
            Add
          </Button>
        </form>
        {cat.formError && !cat.error("name") && <FormError message={cat.formError} />}
      </Card>

      <Card>
        <CardHeader
          title="Items"
          hint="Tap a dish to edit its price, photo, sizes or stock."
          action={
            <Button onClick={() => setEditing("new")} disabled={!categories.data?.length}>
              <Plus className="h-4 w-4" aria-hidden />
              Add item
            </Button>
          }
        />
        <Loadable query={items} skeleton={<ListSkeleton rows={6} cols={2} />}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState icon={ImageIcon} title="No dishes yet" hint="Add a category above, then your first dish." />
            ) : (
              <>
                {categories.data?.map((c) => {
                  const inCat = list.filter((i) => i.categoryId === c.id);
                  if (!inCat.length) return null;
                  return (
                    <div key={c.id} className="mb-6 last:mb-0">
                      <h3 className="muted mb-2 text-xs font-bold tracking-wider uppercase">{c.name}</h3>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {inCat.map((i) => (
                          <li key={i.id}>
                            <button
                              className="line flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition hover:border-brand/40 hover:bg-(--sunken)"
                              onClick={() => setEditing(i)}
                            >
                              {i.imageUrl ? (
                                <img src={i.imageUrl} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                              ) : (
                                <span className="muted grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-(--sunken)">
                                  <ImageIcon className="h-5 w-5" aria-hidden />
                                </span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold">{i.name}</span>
                                <span className="muted block truncate text-sm">
                                  {i.variants.length ? i.variants.map((v) => rupees(v.price)).join(" / ") : rupees(i.price)}
                                </span>
                              </span>
                              {!i.isAvailable && <Badge tone="late">out of stock</Badge>}
                              {i.isBestseller && i.isAvailable && <Badge tone="brand">bestseller</Badge>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </>
            )
          }
        </Loadable>
      </Card>

      <AddonGroups />

      {editing && (
        <ItemForm
          key={editing === "new" ? "new" : editing.id}
          item={editing === "new" ? null : editing}
          categories={categories.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ItemForm({ item, categories, onClose, onSaved }: { item: Item | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const stations = useAdmin<Station[]>("stations");
  const taxes = useAdmin<Tax[]>("taxes");
  const groups = useAdmin<AddonGroup[]>("addon-groups");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const form = useForm({
    initial: {
      name: item?.name ?? "",
      categoryId: item?.categoryId ?? categories[0]?.id ?? "",
      stationId: item?.stationId ?? "",
      price: item ? String(item.price / 100) : "",
      foodType: (item?.foodType ?? "VEG") as FoodType,
      spiceLevel: item?.spiceLevel?.toString() ?? "",
      prepTimeMin: String(item?.prepTimeMin ?? 15),
      description: item?.description ?? "",
      imageUrl: item?.imageUrl ?? "",
      isBestseller: item?.isBestseller ?? false,
      isAvailable: item?.isAvailable ?? true,
      taxIds: item?.taxIds ?? ([] as string[]),
      addonGroupIds: item?.addonGroupIds ?? ([] as string[]),
      variants: item?.variants.map((v) => ({ id: v.id as string | undefined, name: v.name, price: String(v.price / 100) })) ?? [],
    },
    schema: MenuItemInput,
    build: (f) => ({
      name: f.name.trim(),
      categoryId: f.categoryId,
      stationId: orNull(f.stationId),
      // with sizes, the base price is the first size's price
      price: f.variants.length ? paiseOrBlank(f.variants[0]!.price) : paiseOrBlank(f.price),
      foodType: f.foodType,
      spiceLevel: f.spiceLevel === "" ? null : Number(f.spiceLevel),
      prepTimeMin: f.prepTimeMin.trim() === "" ? undefined : Number(f.prepTimeMin),
      description: orNull(f.description),
      imageUrl: orNull(f.imageUrl),
      isBestseller: f.isBestseller,
      isAvailable: f.isAvailable,
      taxIds: f.taxIds,
      addonGroupIds: f.addonGroupIds,
      variants: f.variants.map((v) => ({ id: v.id, name: v.name.trim(), price: paiseOrBlank(v.price) })),
    }),
  });
  const f = form.values;
  const toggleIn = (k: "taxIds" | "addonGroupIds", id: string) => form.set(k, f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id]);
  const setVariant = (i: number, patch: Partial<(typeof f.variants)[number]>) => form.set("variants", f.variants.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // New items default to all taxes (GST) so they're never billed tax-free by accident.
  const taxList = taxes.data;
  const seededTaxes = useRef(false);
  useEffect(() => {
    if (!item && taxList?.length && !seededTaxes.current) {
      seededTaxes.current = true;
      form.set(
        "taxIds",
        taxList.map((t) => t.id),
      );
    }
  }, [item, taxList, form]);

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) return notify.error(new Error("Choose a photo (JPG, PNG or WebP)."));
    setUploading(true);
    try {
      const small = await shrinkImage(file);
      const fd = new FormData();
      fd.append("file", small, "photo.jpg");
      const r = await api<{ url: string }>("POST", "/v1/admin/uploads", fd);
      form.set("imageUrl", r.url);
      notify.ok("Photo uploaded. Save the dish to keep it.");
    } catch (e) {
      notify.error(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const save = form.submit(async (body) => {
    await (item ? api("PATCH", `/v1/admin/items/${item.id}`, body) : api("POST", "/v1/admin/items", body));
    notify.ok(item ? `“${body.name}” saved` : `“${body.name}” added to the menu`);
    onSaved();
  });

  async function remove() {
    if (!item) return;
    if (!(await confirm({ title: `Delete “${item.name}”?`, description: "It disappears from the menu. Past bills keep it.", confirmLabel: "Delete dish", destructive: true }))) return;
    try {
      await api("DELETE", `/v1/admin/items/${item.id}`);
      notify.ok(`“${item.name}” deleted`);
      onSaved();
    } catch (e) {
      notify.error(e);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={item ? `Edit ${item.name}` : "New dish"}
      className="sm:max-w-2xl"
      footer={
        <>
          {item && (
            <Button type="button" variant="ghost" className="mr-auto px-3 text-late hover:bg-late/10" onClick={() => void remove()}>
              <Trash2 className="h-4 w-4" aria-hidden />
              <span>Delete</span>
            </Button>
          )}
          <Button type="button" variant="outline" className="hidden sm:inline-flex" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" className="min-w-32 flex-1 sm:flex-none" disabled={form.busy || uploading}>
            {form.busy ? "Saving…" : item ? "Save" : "Add dish"}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={save} className="grid gap-4" noValidate>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="line group relative grid h-24 w-28 shrink-0 place-items-center overflow-hidden rounded-2xl border border-dashed bg-(--sunken)"
            aria-label={f.imageUrl ? "Change photo" : "Add photo"}
          >
            {f.imageUrl ? <img src={f.imageUrl} alt="" className="h-full w-full object-cover" /> : <Camera className="muted h-7 w-7" aria-hidden />}
            {uploading && (
              <span className="absolute inset-0 grid place-items-center bg-black/45 text-white">
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
              </span>
            )}
          </button>
          <div className="min-w-0 text-sm">
            <p className="font-semibold">Photo</p>
            <p className="muted text-xs">Square or landscape works best. We shrink it for you.</p>
            <div className="mt-2 flex gap-2">
              <Button type="button" variant="outline" className="h-9 min-h-9 px-3 text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : f.imageUrl ? "Change" : "Upload"}
              </Button>
              {f.imageUrl && !uploading && (
                <Button type="button" variant="ghost" className="h-9 min-h-9 px-3 text-xs" onClick={() => form.set("imageUrl", "")}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </div>

        <Field label="Dish name" required error={form.error("name")}>
          <input {...form.text("name")} maxLength={80} placeholder="e.g. Paneer Tikka" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" required error={form.error("categoryId")}>
            <SelectField value={f.categoryId} onChange={(v) => form.set("categoryId", v)} options={categories.map((c) => ({ value: c.id, label: c.name }))} invalid={Boolean(form.error("categoryId"))} />
          </Field>
          <Field label="Type" required>
            <SelectField value={f.foodType} onChange={(v) => form.set("foodType", v as FoodType)} options={FOOD_TYPES} />
          </Field>
          {f.variants.length === 0 && (
            <Field label="Price (₹)" required error={form.error("price")}>
              <input {...form.text("price")} inputMode="decimal" placeholder="0" />
            </Field>
          )}
          <Field label="Kitchen station" hint="Which kitchen screen gets it">
            <SelectField value={f.stationId} onChange={(v) => form.set("stationId", v)} emptyLabel="Any station" options={(stations.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <Field label="Prep time (minutes)" required error={form.error("prepTimeMin")}>
            <input {...form.text("prepTimeMin")} inputMode="numeric" />
          </Field>
          <Field label="Spice level">
            <SelectField value={f.spiceLevel} onChange={(v) => form.set("spiceLevel", v)} emptyLabel="Not shown" options={SPICE} />
          </Field>
        </div>
        <Field label="Description" error={form.error("description")} hint="One line guests see under the name">
          <textarea {...form.text("description")} rows={2} maxLength={300} />
        </Field>

        <fieldset className="line min-w-0 rounded-2xl border p-3">
          <legend className="px-1 text-sm font-semibold">Sizes (Half / Full…)</legend>
          {f.variants.length === 0 && <p className="muted mb-2 text-xs">One price for the dish. Add sizes if it comes in more than one.</p>}
          {f.variants.map((v, i) => (
            <div key={i} className="mb-2 flex items-start gap-2">
              <Field label="Size" required error={form.error(`variants.${i}.name`)} className="flex-1">
                <input value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} placeholder="Half" aria-invalid={form.error(`variants.${i}.name`) ? true : undefined} />
              </Field>
              <Field label="Price (₹)" required error={form.error(`variants.${i}.price`)} className="w-28">
                <input value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} inputMode="decimal" placeholder="0" aria-invalid={form.error(`variants.${i}.price`) ? true : undefined} />
              </Field>
              <button
                type="button"
                aria-label="Remove size"
                className="muted mt-7 grid h-11 w-10 shrink-0 place-items-center rounded-lg hover:bg-late/10 hover:text-late"
                onClick={() => form.set("variants", f.variants.filter((_, j) => j !== i))}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
          <Button type="button" variant="outline" className="h-10 min-h-10 text-sm" onClick={() => form.set("variants", [...f.variants, { id: undefined, name: "", price: "" }])}>
            <Plus className="h-4 w-4" aria-hidden />
            Size
          </Button>
        </fieldset>

        {(taxes.isLoading || (taxes.data?.length ?? 0) > 0) && (
          <div>
            <p className="mb-2 text-sm font-semibold">Taxes</p>
            <div className="flex flex-wrap gap-2">
              {taxes.isLoading && <Skeleton className="h-10 w-40 rounded-xl" />}
              {taxes.data?.map((t) => (
                <label key={t.id} className={CHIP}>
                  <input type="checkbox" checked={f.taxIds.includes(t.id)} onChange={() => toggleIn("taxIds", t.id)} />
                  {t.name} {t.rateBps / 100}%
                </label>
              ))}
            </div>
          </div>
        )}
        {groups.data && groups.data.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">Add-ons</p>
            <div className="flex flex-wrap gap-2">
              {groups.data.map((g) => (
                <label key={g.id} className={CHIP}>
                  <input type="checkbox" checked={f.addonGroupIds.includes(g.id)} onChange={() => toggleIn("addonGroupIds", g.id)} />
                  {g.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <label className={CHIP}>
            <input type="checkbox" checked={f.isBestseller} onChange={(e) => form.set("isBestseller", e.target.checked)} /> Bestseller
          </label>
          <label className={CHIP}>
            <input type="checkbox" checked={f.isAvailable} onChange={(e) => form.set("isAvailable", e.target.checked)} /> In stock
          </label>
        </div>
        <FormError message={form.formError} />
      </form>
    </Modal>
  );
}

/** Add-on groups: "Name: price" one per line keeps entry fast. */
function AddonGroups() {
  const qc = useQueryClient();
  const groups = useAdmin<AddonGroup[]>("addon-groups");
  const form = useForm({
    initial: { name: "", minSelect: "0", maxSelect: "1", addons: "" },
    schema: AddonGroupInput,
    build: (v) => ({
      name: v.name.trim(),
      minSelect: v.minSelect.trim() === "" ? undefined : Number(v.minSelect),
      maxSelect: v.maxSelect.trim() === "" ? undefined : Number(v.maxSelect),
      addons: v.addons
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [n, p] = l.split(":");
          return { name: (n ?? "").trim(), price: toPaise((p ?? "0").trim()), isAvailable: true };
        }),
    }),
  });
  const create = form.submit(async (body) => {
    if (!body.addons.length) return form.setFormError("Add at least one option, one per line.");
    await api("POST", "/v1/admin/addon-groups", body);
    form.reset();
    notify.ok(`Add-on group “${body.name}” added`);
    void qc.invalidateQueries({ queryKey: ["admin", "addon-groups"] });
  });
  // the min ≤ max check has no field path, so it shows on the "max" field
  const rangeError = form.error("") ?? form.error("maxSelect");

  return (
    <Card>
      <CardHeader title="Add-on groups" hint="Choices like breads, toppings or extra cheese, attached to dishes." />
      <Loadable query={groups} skeleton={<CardSkeleton lines={2} className="mb-5 border-0 p-0 shadow-none sm:p-0" />}>
        {(list) => (
          <ul className="mb-5 grid gap-2 sm:grid-cols-2">
            {list.map((g) => (
              <li key={g.id} className="line rounded-xl border p-3 text-sm">
                <p className="font-semibold">
                  {g.name}{" "}
                  <span className="muted text-xs font-medium">
                    choose {g.minSelect}–{g.maxSelect}
                  </span>
                </p>
                <p className="muted mt-0.5">{g.addons.map((a) => `${a.name}${a.price ? ` +${rupees(a.price)}` : ""}`).join(", ")}</p>
              </li>
            ))}
          </ul>
        )}
      </Loadable>
      <form onSubmit={create} className="grid gap-3 rounded-xl bg-(--sunken) p-3 sm:grid-cols-[2fr_1fr_1fr] sm:p-4" noValidate>
        <Field label="Group name" required error={form.error("name")}>
          <input {...form.text("name")} placeholder="e.g. Choose bread" maxLength={60} />
        </Field>
        <Field label="Min choices" required error={form.error("minSelect")}>
          <input {...form.text("minSelect")} inputMode="numeric" />
        </Field>
        <Field label="Max choices" required error={rangeError}>
          <input {...form.text("maxSelect")} inputMode="numeric" />
        </Field>
        <Field label="Options" required error={form.error("addons")} hint="One per line as Name: price, e.g. Garlic Naan: 20" className="sm:col-span-3">
          <textarea {...form.text("addons")} rows={3} placeholder={"Butter Naan: 0\nGarlic Naan: 20"} />
        </Field>
        <div className="space-y-2 sm:col-span-3">
          <FormError message={form.formError} />
          <Button type="submit" disabled={form.busy} className="w-full sm:w-auto">
            <Plus className="h-4 w-4" aria-hidden />
            Add group
          </Button>
        </div>
      </form>
    </Card>
  );
}
