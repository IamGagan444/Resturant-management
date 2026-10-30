"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FoodType } from "@rms/contracts";
import { api, rupees, toPaise } from "@/lib/api";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { Sheet } from "@/components/Sheet";

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

function useAdmin<T>(key: string) {
  return useQuery({ queryKey: ["admin", key], queryFn: () => api<T>("GET", `/v1/admin/${key}`) });
}

export function MenuTab() {
  const qc = useQueryClient();
  const categories = useAdmin<Category[]>("categories");
  const items = useAdmin<Item[]>("items");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [catName, setCatName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/v1/admin/categories", { name: catName, sortOrder: (categories.data?.length ?? 0) + 1 });
      setCatName("");
      refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-3 text-lg font-bold">Categories</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {categories.data?.map((c) => (
            <span key={c.id} className="line inline-flex items-center gap-2 rounded-full border px-3 py-1">
              {c.name}
              {c.availableFrom && (
                <span className="muted text-xs">
                  {c.availableFrom}–{c.availableTo}
                </span>
              )}
              <button
                aria-label={`Delete ${c.name}`}
                className="muted"
                onClick={() => api("DELETE", `/v1/admin/categories/${c.id}`).then(refresh, setError)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={addCategory} className="flex gap-2">
          <input required placeholder="New category" aria-label="New category name" value={catName} onChange={(e) => setCatName(e.target.value)} className="flex-1" />
          <Button type="submit">Add</Button>
        </form>
        <ErrorText error={error} />
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Items</h2>
          <Button onClick={() => setEditing("new")} disabled={!categories.data?.length}>
            + Add item
          </Button>
        </div>
        {categories.data?.map((c) => {
          const list = items.data?.filter((i) => i.categoryId === c.id) ?? [];
          if (!list.length) return null;
          return (
            <div key={c.id} className="mb-4">
              <h3 className="muted mb-1 text-sm font-semibold uppercase">{c.name}</h3>
              <ul className="line divide-y divide-(--line) rounded-xl border">
                {list.map((i) => (
                  <li key={i.id}>
                    <button className="flex w-full items-center gap-3 px-3 py-2 text-left" onClick={() => setEditing(i)}>
                      <span className="flex-1">
                        {i.name} {!i.isAvailable && <span className="text-xs text-late">out of stock</span>}
                      </span>
                      <span className="muted text-sm">{i.variants.length ? i.variants.map((v) => rupees(v.price)).join(" / ") : rupees(i.price)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </Card>

      <AddonGroups />

      {editing && (
        <ItemForm
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
  const [f, setF] = useState(() => ({
    name: item?.name ?? "",
    categoryId: item?.categoryId ?? categories[0]?.id ?? "",
    stationId: item?.stationId ?? "",
    price: item ? String(item.price / 100) : "",
    foodType: item?.foodType ?? ("VEG" as FoodType),
    spiceLevel: item?.spiceLevel?.toString() ?? "",
    prepTimeMin: String(item?.prepTimeMin ?? 15),
    description: item?.description ?? "",
    imageUrl: item?.imageUrl ?? "",
    isBestseller: item?.isBestseller ?? false,
    isAvailable: item?.isAvailable ?? true,
    taxIds: item?.taxIds ?? [],
    addonGroupIds: item?.addonGroupIds ?? [],
    variants: item?.variants.map((v) => ({ id: v.id as string | undefined, name: v.name, price: String(v.price / 100) })) ?? [],
  }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const toggleIn = (k: "taxIds" | "addonGroupIds", id: string) => set(k, f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id]);

  // New items default to all taxes (GST) so they're never billed tax-free by accident.
  const taxList = taxes.data;
  useEffect(() => {
    if (!item && taxList?.length) setF((cur) => (cur.taxIds.length ? cur : { ...cur, taxIds: taxList.map((t) => t.id) }));
  }, [item, taxList]);

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api<{ url: string }>("POST", "/v1/admin/uploads", fd);
      set("imageUrl", r.url);
    } catch (e) {
      setError(e);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name,
      categoryId: f.categoryId,
      stationId: f.stationId || null,
      price: f.variants.length ? toPaise(f.variants[0]!.price) : toPaise(f.price),
      foodType: f.foodType,
      spiceLevel: f.spiceLevel === "" ? null : Number(f.spiceLevel),
      prepTimeMin: Number(f.prepTimeMin),
      description: f.description || null,
      imageUrl: f.imageUrl || null,
      isBestseller: f.isBestseller,
      isAvailable: f.isAvailable,
      taxIds: f.taxIds,
      addonGroupIds: f.addonGroupIds,
      variants: f.variants.map((v) => ({ id: v.id, name: v.name, price: toPaise(v.price) })),
    };
    try {
      await (item ? api("PATCH", `/v1/admin/items/${item.id}`, body) : api("POST", "/v1/admin/items", body));
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={item ? `Edit ${item.name}` : "New item"}>
      <form onSubmit={save} className="grid gap-3">
        <Field label="Name">
          <input required value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kitchen station">
            <select value={f.stationId} onChange={(e) => set("stationId", e.target.value)}>
              <option value="">Any</option>
              {stations.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          {f.variants.length === 0 && (
            <Field label="Price (₹)">
              <input required inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} />
            </Field>
          )}
          <Field label="Type">
            <select value={f.foodType} onChange={(e) => set("foodType", e.target.value as FoodType)}>
              <option value="VEG">Veg</option>
              <option value="NON_VEG">Non-veg</option>
              <option value="EGG">Egg</option>
              <option value="VEGAN">Vegan</option>
            </select>
          </Field>
          <Field label="Prep time (min)">
            <input inputMode="numeric" value={f.prepTimeMin} onChange={(e) => set("prepTimeMin", e.target.value)} />
          </Field>
          <Field label="Spice (0–3)">
            <input inputMode="numeric" value={f.spiceLevel} onChange={(e) => set("spiceLevel", e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="Photo">
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </Field>
        {f.imageUrl && (
          // admin preview; plain img is fine here
          <img src={f.imageUrl} alt="" className="h-24 w-32 rounded-lg object-cover" />
        )}

        <fieldset className="line rounded-xl border p-3">
          <legend className="px-1 font-semibold">Sizes (Half / Full…)</legend>
          {f.variants.map((v, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input aria-label="Size name" placeholder="Half" value={v.name} onChange={(e) => set("variants", f.variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="flex-1" />
              <input aria-label="Size price" placeholder="₹" inputMode="decimal" value={v.price} onChange={(e) => set("variants", f.variants.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} className="w-24" />
              <button type="button" aria-label="Remove size" onClick={() => set("variants", f.variants.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => set("variants", [...f.variants, { id: undefined, name: "", price: "" }])}>
            + Size
          </Button>
        </fieldset>

        <div className="flex flex-wrap gap-4">
          {taxes.data?.map((t) => (
            <label key={t.id} className="flex items-center gap-2">
              <input type="checkbox" checked={f.taxIds.includes(t.id)} onChange={() => toggleIn("taxIds", t.id)} />
              {t.name} {t.rateBps / 100}%
            </label>
          ))}
        </div>
        {groups.data && groups.data.length > 0 && (
          <div className="flex flex-wrap gap-4">
            {groups.data.map((g) => (
              <label key={g.id} className="flex items-center gap-2">
                <input type="checkbox" checked={f.addonGroupIds.includes(g.id)} onChange={() => toggleIn("addonGroupIds", g.id)} />
                {g.name}
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.isBestseller} onChange={(e) => set("isBestseller", e.target.checked)} /> Bestseller
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.isAvailable} onChange={(e) => set("isAvailable", e.target.checked)} /> In stock
          </label>
        </div>
        <ErrorText error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy} className="flex-1">
            Save
          </Button>
          {item && (
            <Button type="button" variant="danger" onClick={() => api("DELETE", `/v1/admin/items/${item.id}`).then(onSaved, setError)}>
              Delete
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

/** Add-on groups: "Name: price" one per line keeps entry fast. */
function AddonGroups() {
  const qc = useQueryClient();
  const groups = useAdmin<AddonGroup[]>("addon-groups");
  const [name, setName] = useState("");
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("1");
  const [lines, setLines] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const addons = lines
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [n, p] = l.split(":");
        return { name: (n ?? "").trim(), price: toPaise((p ?? "0").trim()), isAvailable: true };
      });
    try {
      await api("POST", "/v1/admin/addon-groups", { name, minSelect: Number(min), maxSelect: Number(max), addons });
      setName("");
      setLines("");
      void qc.invalidateQueries({ queryKey: ["admin", "addon-groups"] });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">Add-on groups</h2>
      <ul className="mb-4 space-y-1 text-sm">
        {groups.data?.map((g) => (
          <li key={g.id}>
            <strong>{g.name}</strong> <span className="muted">(choose {g.minSelect}–{g.maxSelect})</span>: {g.addons.map((a) => `${a.name}${a.price ? ` +${rupees(a.price)}` : ""}`).join(", ")}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
        <input required placeholder="Group name (e.g. Choose bread)" aria-label="Group name" value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="Minimum choices" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
        <input aria-label="Maximum choices" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
        <textarea required rows={3} className="sm:col-span-3" placeholder={"Butter Naan: 0\nGarlic Naan: 20"} aria-label="Options, one per line as Name: price" value={lines} onChange={(e) => setLines(e.target.value)} />
        <Button type="submit" className="sm:col-span-3">
          Add group
        </Button>
      </form>
      <ErrorText error={error} />
    </Card>
  );
}
