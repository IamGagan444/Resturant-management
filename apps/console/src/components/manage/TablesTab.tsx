"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FloorInput, TableInput } from "@rms/contracts";
import { Download, ExternalLink, Layers, Plus, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { API_URL, api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, FormError, SelectField, orNull, useForm } from "@/components/ui";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { Loadable, confirm, notify } from "@/components/ui/feedback";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

interface Floor { id: string; name: string }
interface Table { id: string; label: string; seats: number; floorId: string | null; status: string; isActive: boolean; qrUrl: string }

export function TablesTab() {
  const qc = useQueryClient();
  const floors = useQuery({ queryKey: ["admin", "floors"], queryFn: () => api<Floor[]>("GET", "/v1/admin/floors") });
  const tables = useQuery({ queryKey: ["admin", "tables"], queryFn: () => api<Table[]>("GET", "/v1/admin/tables") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  const floorName = (id: string | null) => floors.data?.find((f) => f.id === id)?.name ?? "No floor";

  const table = useForm({
    initial: { label: "", seats: "4", floorId: "" },
    schema: TableInput,
    build: (v) => ({ label: v.label.trim(), seats: v.seats.trim() === "" ? undefined : Number(v.seats), floorId: orNull(v.floorId) }),
  });
  const addTable = table.submit(async (body) => {
    if (tables.data?.some((t) => t.isActive && t.label.toLowerCase() === body.label.toLowerCase())) {
      return table.setFormError(`There's already a table called ${body.label}.`);
    }
    await api("POST", "/v1/admin/tables", body);
    table.reset({ ...table.values, label: "" });
    notify.ok(`Table ${body.label} added. Print its QR from the sheet.`);
    refresh();
  });

  const floor = useForm({
    initial: { name: "" },
    schema: FloorInput,
    build: (v) => ({ name: v.name.trim(), sortOrder: floors.data?.length ?? 0 }),
  });
  const addFloor = floor.submit(async (body) => {
    await api("POST", "/v1/admin/floors", body);
    floor.reset();
    notify.ok(`Floor “${body.name}” added`);
    refresh();
  });

  async function newQr(t: Table) {
    const ok = await confirm({
      title: `New QR code for ${t.label}?`,
      description: "The QR code printed on this table stops working. Print the new one from the QR sheet and replace it.",
      confirmLabel: "Make new QR",
    });
    if (!ok) return;
    try {
      await api("POST", `/v1/admin/tables/${t.id}/rotate-qr`);
      notify.ok(`New QR made for ${t.label}`);
      refresh();
    } catch (e) {
      notify.error(e);
    }
  }

  async function remove(t: Table) {
    if (!(await confirm({ title: `Remove table ${t.label}?`, description: "Its QR code stops working. Past bills are kept.", confirmLabel: "Remove table", destructive: true }))) return;
    try {
      await api("DELETE", `/v1/admin/tables/${t.id}`);
      notify.ok(`Table ${t.label} removed`);
      refresh();
    } catch (e) {
      notify.error(e);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Tables"
          hint="Each table gets its own QR code. Print the sheet and stick one on every table."
          action={
            <a
              href={`${API_URL}/v1/admin/tables/qr-sheet.pdf`}
              target="_blank"
              rel="noreferrer"
              className="tap inline-flex items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_6px_16px_-8px_var(--color-brand)] hover:brightness-110"
            >
              <Download className="h-4 w-4" aria-hidden />
              Printable QR sheet (PDF)
            </a>
          }
        />
        <form className="mb-5 grid gap-3 rounded-xl bg-(--sunken) p-3 sm:grid-cols-[1fr_6rem_1fr_auto] sm:items-start sm:p-4" onSubmit={addTable} noValidate>
          <Field label="Table name" required error={table.error("label")}>
            <input {...table.text("label")} placeholder="e.g. T9" maxLength={20} />
          </Field>
          <Field label="Seats" required error={table.error("seats")}>
            <input {...table.text("seats")} inputMode="numeric" />
          </Field>
          <Field label="Floor">
            <SelectField value={table.values.floorId} onChange={(v) => table.set("floorId", v)} emptyLabel="No floor" options={(floors.data ?? []).map((f) => ({ value: f.id, label: f.name }))} />
          </Field>
          <Button type="submit" className="sm:mt-6.5" disabled={table.busy}>
            <Plus className="h-4 w-4" aria-hidden />
            Add table
          </Button>
          {table.formError && (
            <div className="sm:col-span-4">
              <FormError message={table.formError} />
            </div>
          )}
        </form>
        <Loadable query={tables} skeleton={<ListSkeleton rows={6} cols={2} />}>
          {(all) => {
            const list = all.filter((t) => t.isActive);
            if (!list.length) return <EmptyState icon={QrCode} title="No tables yet" hint="Add your first table above. Each one gets its own QR code." />;
            return (
              <ul className="grid gap-2 md:grid-cols-2">
                {list.map((t) => (
                  <li key={t.id} className="line flex items-center gap-3 rounded-xl border p-3">
                    <span className="grid h-12 min-w-12 shrink-0 place-items-center rounded-xl bg-brand/10 px-2 text-lg font-extrabold text-brand">{t.label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {floorName(t.floorId)} · {t.seats} seats
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge tone={t.status === "FREE" ? "fresh" : "brand"} className="capitalize">
                          {t.status.toLowerCase().replace("_", " ")}
                        </Badge>
                        <a href={t.qrUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                          Guest page
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      </span>
                    </span>
                    <RowActions label={`Actions for table ${t.label}`}>
                      <DropdownMenuItem onSelect={() => window.open(t.qrUrl, "_blank", "noopener")}>
                        <ExternalLink aria-hidden /> Open guest page
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void newQr(t)}>
                        <RefreshCw aria-hidden /> New QR code
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => void remove(t)}>
                        <Trash2 aria-hidden /> Remove table
                      </DropdownMenuItem>
                    </RowActions>
                  </li>
                ))}
              </ul>
            );
          }}
        </Loadable>
      </Card>

      <Card>
        <CardHeader title="Floors" hint="Group tables by area: ground floor, rooftop, AC hall…" />
        <Loadable
          query={floors}
          skeleton={
            <div className="mb-4 flex gap-2">
              <Skeleton className="h-9 w-28 rounded-full" />
              <Skeleton className="h-9 w-24 rounded-full" />
            </div>
          }
        >
          {(list) => (
            <div className="mb-4 flex flex-wrap gap-2">
              {list.length ? (
                list.map((f) => (
                  <span key={f.id} className="line inline-flex h-9 items-center gap-2 rounded-full border bg-(--sunken) px-3.5 text-sm font-medium">
                    <Layers className="h-3.5 w-3.5 text-brand" aria-hidden />
                    {f.name}
                  </span>
                ))
              ) : (
                <p className="muted text-sm">No floors yet</p>
              )}
            </div>
          )}
        </Loadable>
        <form className="flex items-start gap-2" onSubmit={addFloor} noValidate>
          <Field label="New floor" required error={floor.error("name")} className="flex-1">
            <input {...floor.text("name")} placeholder="e.g. Rooftop" maxLength={40} />
          </Field>
          <Button type="submit" className="mt-6.5" disabled={floor.busy}>
            <Plus className="h-4 w-4" aria-hidden />
            Add floor
          </Button>
        </form>
        {floor.formError && !floor.error("name") && <FormError message={floor.formError} />}
      </Card>
    </div>
  );
}
