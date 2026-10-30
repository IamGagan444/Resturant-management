"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api } from "@/lib/api";
import { Button, Card, ErrorText } from "@/components/ui";

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Tables</h2>
          <a href={`${API_URL}/v1/admin/tables/qr-sheet.pdf`} target="_blank" rel="noreferrer" className="tap bg-brand inline-flex items-center rounded-xl px-4 font-semibold text-white">
            ⬇ Printable QR sheet (PDF)
          </a>
        </div>
        <form
          className="my-4 grid gap-2 sm:grid-cols-[1fr_6rem_1fr_auto]"
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
          <Button type="submit">Add table</Button>
        </form>
        <ul className="line divide-y divide-(--line) rounded-xl border">
          {tables.data
            ?.filter((t) => t.isActive)
            .map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-16 text-lg font-bold">{t.label}</span>
                <span className="muted text-sm">
                  {floors.data?.find((f) => f.id === t.floorId)?.name ?? "—"} · {t.seats} seats · {t.status.toLowerCase()}
                </span>
                <a href={t.qrUrl} target="_blank" rel="noreferrer" className="text-sm text-brand underline">
                  Open guest page
                </a>
                <span className="ml-auto flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => confirm(`Invalidate the printed QR for ${t.label}? You'll need to print a new one.`) && void run(api("POST", `/v1/admin/tables/${t.id}/rotate-qr`))}
                  >
                    New QR
                  </Button>
                  <Button variant="ghost" aria-label={`Remove ${t.label}`} onClick={() => void run(api("DELETE", `/v1/admin/tables/${t.id}`))}>
                    ✕
                  </Button>
                </span>
              </li>
            ))}
        </ul>
        <ErrorText error={error} />
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">Floors</h2>
        <p className="mb-3">{floors.data?.map((f) => f.name).join(" · ") || "No floors yet"}</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(api("POST", "/v1/admin/floors", { name: floorName, sortOrder: floors.data?.length ?? 0 }).then(() => setFloorName("")));
          }}
        >
          <input required className="flex-1" placeholder="e.g. Rooftop" aria-label="Floor name" value={floorName} onChange={(e) => setFloorName(e.target.value)} />
          <Button type="submit">Add floor</Button>
        </form>
      </Card>
    </div>
  );
}
