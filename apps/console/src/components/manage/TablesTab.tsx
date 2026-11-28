"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FloorInput, TableInput } from "@rms/contracts";
import { formatTableCode } from "@rms/domain";
import { NfcWriteButton } from "./NfcWrite";
import { Download, ExternalLink, Layers, Plus, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { API_URL, api } from "@/lib/api";
import { Button, Card, CardHeader, EmptyState, Field, FormError, SelectField, orNull, useForm } from "@/components/ui";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { Loadable, confirm, notify } from "@/components/ui/feedback";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

interface Floor { id: string; name: string }
interface Table { id: string; label: string; seats: number; floorId: string | null; status: string; isActive: boolean; qrUrl: string; code: string; isParcelCounter: boolean }

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
  const addCounter = async () => {
    try {
      await api("POST", "/v1/admin/tables", { label: "Parcel counter", seats: 1, isParcelCounter: true });
      notify.ok("Parcel counter added. Print its QR from the sheet.");
      refresh();
    } catch (e) {
      notify.error(e);
    }
  };
  const addTable = table.submit(async (body) => {
    if (tables.data?.some((t) => t.isActive && t.label.toLowerCase() === body.label.toLowerCase())) {
      return table.setFormError(`There's already a table called ${body.label}.`);
    }
    const created = await api<Table>("POST", "/v1/admin/tables", body);
    // Show it now; the background refetch below just confirms.
    qc.setQueryData<Table[]>(["admin", "tables"], (old) => [...(old ?? []).filter((t) => t.id !== created.id), created]);
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
      description: "The QR code and table code printed on this table stop working. Print the new one from the QR sheet and replace it.",
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
    if (!(await confirm({ title: `Remove table ${t.label}?`, description: "Its QR code and table code stop working. Past bills are kept.", confirmLabel: "Remove table", destructive: true }))) return;
    try {
      await api("DELETE", `/v1/admin/tables/${t.id}`);
      qc.setQueryData<Table[]>(["admin", "tables"], (old) => old?.filter((x) => x.id !== t.id));
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
          hint="Each table gets its own QR code, with a table code below it for guests who can't scan. Print the sheet and stick one on every table. For tap-to-open, write the same link onto an NFC card with the NFC button."
          action={
            <a
              href={`${API_URL}/v1/admin/tables/qr-sheet.pdf`}
              target="_blank"
              rel="noreferrer"
              className="tap inline-flex items-center gap-2 rounded-full bg-(--surface) px-4 text-sm font-semibold text-(--ink) ring-1 ring-(--line) transition ring-inset hover:bg-(--sunken) sm:text-[15px]"
            >
              <Download className="h-4 w-4" aria-hidden />
              Printable QR sheet (PDF)
            </a>
          }
        />
        <form className="mb-5 grid grid-cols-2 gap-3 rounded-xl bg-(--sunken) p-3 sm:grid-cols-[1fr_6rem_1fr_auto] sm:items-start sm:p-4" onSubmit={addTable} noValidate>
          <Field label="Table name" required error={table.error("label")} className="col-span-2 sm:col-span-1">
            <input {...table.text("label")} placeholder="e.g. T9" maxLength={20} />
          </Field>
          <Field label="Seats" required error={table.error("seats")}>
            <input {...table.text("seats")} inputMode="numeric" />
          </Field>
          <Field label="Floor">
            <SelectField value={table.values.floorId} onChange={(v) => table.set("floorId", v)} emptyLabel="No floor" options={(floors.data ?? []).map((f) => ({ value: f.id, label: f.name }))} />
          </Field>
          <Button type="submit" className="col-span-2 sm:col-span-1 sm:mt-6.5" disabled={table.busy}>
            <Plus className="h-4 w-4" aria-hidden />
            Add table
          </Button>
          {table.formError && (
            <div className="col-span-2 sm:col-span-4">
              <FormError message={table.formError} />
            </div>
          )}
        </form>
        {tables.data && !tables.data.some((t) => t.isActive && t.isParcelCounter) && (
          <div className="line mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 sm:p-4">
            <p className="min-w-0 flex-1 basis-64 text-sm leading-relaxed text-pretty">
              <strong>Walk-in parcels?</strong> <span className="muted">Add a parcel counter: customers scan its QR, order, and get a token. Many can order at the same time.</span>
            </p>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => void addCounter()}>
              <Plus className="h-4 w-4" aria-hidden />
              Add parcel counter
            </Button>
          </div>
        )}
        <Loadable query={tables} skeleton={<ListSkeleton rows={6} cols={2} />}>
          {(all) => {
            const list = all.filter((t) => t.isActive);
            if (!list.length) return <EmptyState icon={QrCode} title="No tables yet" hint="Add your first table above. Each one gets its own QR code." />;
            return (
              <ul className="grid gap-2 md:grid-cols-2">
                {list.map((t) => {
                  const busy = t.isParcelCounter || t.status !== "FREE";
                  return (
                  <li key={t.id} className="line flex items-center gap-3 rounded-xl border bg-(--surface) py-2 pr-1 pl-2">
                    <span className="grid h-10 min-w-10 shrink-0 place-items-center rounded-lg bg-(--sunken) px-1.5 text-sm font-bold">{t.label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {t.isParcelCounter ? "Parcel counter" : `${floorName(t.floorId)} · ${t.seats} seats`}
                      </span>
                      <span className="muted mt-0.5 flex items-center gap-1.5 text-xs">
                        <span className={`inline-flex items-center gap-1 font-medium capitalize ${busy ? "text-brand" : "text-fresh"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${busy ? "bg-brand" : "bg-fresh"}`} aria-hidden />
                          {t.isParcelCounter ? "parcel" : t.status.toLowerCase().replace("_", " ")}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="truncate font-mono tracking-wide text-(--ink)" title="Table code">
                          {formatTableCode(t.code)}
                        </span>
                      </span>
                    </span>
                    <a
                      href={t.qrUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Guest page for ${t.label}`}
                      title="Guest page"
                      className="muted grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-(--sunken) hover:text-brand"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                    <NfcWriteButton compact url={t.qrUrl} what={t.isParcelCounter ? "the parcel counter" : `table ${t.label}`} />
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
                  );
                })}
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
