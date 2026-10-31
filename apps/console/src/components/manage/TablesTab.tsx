"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api } from "@/lib/api";
import { Download, ExternalLink, Layers, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorText } from "@/components/ui";

interface Floor { id: string; name: string }
interface Table { id: string; label: string; seats: number; floorId: string | null; status: string; isActive: boolean; qrUrl: string }

export function TablesTab() {
  const qc = useQueryClient();
  const floors = useQuery({ queryKey: ["admin", "floors"], queryFn: () => api<Floor[]>("GET", "/v1/admin/floors") });
  const tables = useQuery({ queryKey: ["admin", "tables"], queryFn: () => api<Table[]>("GET", "/v1/admin/tables") });
  const [label, setLabel] = useState("");
  const [seats, setSeats] = useState("4");
  const [floorId, setFloorId] = useState("");
  const [floorName, setFloorName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  const run = (p: Promise<unknown>) => p.then(refresh, setError);

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
        <form
          className="mb-5 grid gap-2 rounded-xl bg-(--sunken) p-3 sm:grid-cols-[1fr_6rem_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run(api("POST", "/v1/admin/tables", { label, seats: Number(seats), floorId: floorId || null }).then(() => setLabel("")));
          }}
        >
          <input required placeholder="Label, e.g. T9" aria-label="Table label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input aria-label="Seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
          <select aria-label="Floor" value={floorId} onChange={(e) => setFloorId(e.target.value)}>
            <option value="">No floor</option>
            {floors.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <Button type="submit">
            <Plus className="h-4 w-4" aria-hidden />
            Add table
          </Button>
        </form>
        <ul className="grid gap-2 md:grid-cols-2">
          {tables.data
            ?.filter((t) => t.isActive)
            .map((t) => (
              <li key={t.id} className="line flex items-center gap-3 rounded-xl border p-3">
                <span className="grid h-12 min-w-12 shrink-0 place-items-center rounded-xl bg-brand/10 px-2 text-lg font-extrabold text-brand">{t.label}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {floors.data?.find((f) => f.id === t.floorId)?.name ?? "No floor"} · {t.seats} seats
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <Badge tone={t.status === "FREE" ? "fresh" : "brand"} className="capitalize">
                      {t.status.toLowerCase().replace("_", " ")}
                    </Badge>
                    <a href={t.qrUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                      Open guest page
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  </span>
                </span>
                <Button
                  variant="outline"
                  className="px-3 text-sm"
                  title="Replace this table's QR code"
                  onClick={() => confirm(`Invalidate the printed QR for ${t.label}? You'll need to print a new one.`) && void run(api("POST", `/v1/admin/tables/${t.id}/rotate-qr`))}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">New QR</span>
                </Button>
                <Button variant="ghost" className="muted px-0 hover:text-late" aria-label={`Remove ${t.label}`} onClick={() => void run(api("DELETE", `/v1/admin/tables/${t.id}`))}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
        </ul>
        <ErrorText error={error} />
      </Card>

      <Card>
        <CardHeader title="Floors" hint="Group tables by area: ground floor, rooftop, AC hall…" />
        <div className="mb-4 flex flex-wrap gap-2">
          {floors.data?.length ? (
            floors.data.map((f) => (
              <span key={f.id} className="line inline-flex h-9 items-center gap-2 rounded-full border bg-(--sunken) px-3.5 text-sm font-medium">
                <Layers className="h-3.5 w-3.5 text-brand" aria-hidden />
                {f.name}
              </span>
            ))
          ) : (
            <p className="muted text-sm">No floors yet</p>
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(api("POST", "/v1/admin/floors", { name: floorName, sortOrder: floors.data?.length ?? 0 }).then(() => setFloorName("")));
          }}
        >
          <input required className="min-w-0 flex-1" placeholder="e.g. Rooftop" aria-label="Floor name" value={floorName} onChange={(e) => setFloorName(e.target.value)} />
          <Button type="submit">
            <Plus className="h-4 w-4" aria-hidden />
            Add floor
          </Button>
        </form>
      </Card>
    </div>
  );
}
