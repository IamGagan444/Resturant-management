"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BILLING_CYCLE_LABEL, BillingCycle, PlanInput, cyclePrice, cycleSavingPct, type PlanView } from "@rms/contracts";
import { CreditCard, Pencil, Plus } from "lucide-react";
import { api, toPaise } from "@/lib/api";
import { Badge, Button, EmptyState, Field, FormError, useForm } from "@/components/ui";
import { Loadable, notify } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageTitle } from "@/components/platform/common";

const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const PER: Record<BillingCycle, string> = { MONTHLY: "month", QUARTERLY: "3 months", YEARLY: "year" };

/** Super admin: subscription plans and their monthly / quarterly / yearly prices. */
export default function PlansPage() {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["p", "plans"], queryFn: () => api<PlanView[]>("GET", "/v1/platform/plans") });
  const [editing, setEditing] = useState<PlanView | "new" | null>(null);
  return (
    <>
      <PageTitle
        title="Plans"
        hint="What restaurants pay. Offer quarterly and yearly prices at a discount to get paid upfront; leave one blank to not offer it."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" aria-hidden /> New plan
          </Button>
        }
      />
      <Loadable query={plans} skeleton={<ListSkeleton rows={2} cols={2} />}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={CreditCard} title="No plans yet" hint="Create the plans restaurants can subscribe to." />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((p) => (
                <li key={p.id} className="surface line rounded-2xl border p-5 shadow-soft">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight">{p.name}</h2>
                      <p className="muted text-sm">
                        Up to {p.maxTables} tables · {p.maxStaff} staff
                      </p>
                    </div>
                    <Button variant="ghost" className="h-9 w-9 px-0" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  <dl className="space-y-1.5 text-sm">
                    {BillingCycle.options.map((c) => {
                      const price = cyclePrice(p, c);
                      const save = cycleSavingPct(p, c);
                      return (
                        <div key={c} className="flex items-center justify-between gap-2">
                          <dt className="muted">{BILLING_CYCLE_LABEL[c]}</dt>
                          <dd className="flex items-center gap-1.5 font-semibold tabular-nums">
                            {price === null ? <span className="muted font-normal">not offered</span> : `${rs(price)} / ${PER[c]}`}
                            {save > 0 && <Badge tone="fresh">save {save}%</Badge>}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>
      {editing && <PlanEditor plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => void qc.invalidateQueries({ queryKey: ["p", "plans"] })} />}
    </>
  );
}

const rupeesText = (paise: number | null) => (paise === null ? "" : String(paise / 100));
const paiseOrNull = (s: string) => (s.trim() === "" ? null : toPaise(s));

function PlanEditor({ plan, onClose, onSaved }: { plan: PlanView | null; onClose: () => void; onSaved: () => void }) {
  const form = useForm({
    initial: {
      name: plan?.name ?? "",
      priceMonthly: rupeesText(plan?.priceMonthly ?? null),
      priceQuarterly: rupeesText(plan?.priceQuarterly ?? null),
      priceYearly: rupeesText(plan?.priceYearly ?? null),
      maxTables: String(plan?.maxTables ?? 15),
      maxStaff: String(plan?.maxStaff ?? 10),
    },
    schema: PlanInput,
    build: (v) => ({
      name: v.name.trim(),
      priceMonthly: paiseOrNull(v.priceMonthly) ?? Number.NaN,
      priceQuarterly: paiseOrNull(v.priceQuarterly),
      priceYearly: paiseOrNull(v.priceYearly),
      maxTables: Number(v.maxTables),
      maxStaff: Number(v.maxStaff),
      features: plan?.features ?? { kds: true, offlineMode: false, inventory: false, roomService: false },
    }),
  });
  const v = form.values;
  const monthly = paiseOrNull(v.priceMonthly);
  const hint = (cycle: "QUARTERLY" | "YEARLY") => {
    const price = paiseOrNull(cycle === "QUARTERLY" ? v.priceQuarterly : v.priceYearly);
    if (!monthly || price === null || Number.isNaN(price)) return `Blank = not offered. ${monthly ? `Full price ${rs(monthly * (cycle === "QUARTERLY" ? 3 : 12))}.` : ""}`;
    const save = cycleSavingPct({ priceMonthly: monthly, priceQuarterly: cycle === "QUARTERLY" ? price : null, priceYearly: cycle === "YEARLY" ? price : null }, cycle);
    return save ? `Saves ${save}% vs monthly` : "No saving vs monthly";
  };
  const save = form.submit(async (body) => {
    await (plan ? api("PATCH", `/v1/platform/plans/${plan.id}`, body) : api("POST", "/v1/platform/plans", body));
    notify.ok(plan ? `${body.name} updated` : `${body.name} created`);
    onSaved();
    onClose();
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={plan ? `Edit ${plan.name}` : "New plan"}
      description="Price changes apply to each restaurant from its next billing period."
      footer={
        <>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="plan-editor" className="flex-1 sm:flex-none" disabled={form.busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="plan-editor" onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Name" required error={form.error("name")} className="sm:col-span-2">
          <input {...form.text("name")} maxLength={40} placeholder="e.g. Starter" />
        </Field>
        <Field label="Monthly price (₹)" required error={form.error("priceMonthly")}>
          <input {...form.text("priceMonthly")} inputMode="decimal" placeholder="999" />
        </Field>
        <Field label="Quarterly price (₹, 3 months)" error={form.error("priceQuarterly")} hint={hint("QUARTERLY")}>
          <input {...form.text("priceQuarterly")} inputMode="decimal" placeholder="2699" />
        </Field>
        <Field label="Yearly price (₹, 12 months)" error={form.error("priceYearly")} hint={hint("YEARLY")}>
          <input {...form.text("priceYearly")} inputMode="decimal" placeholder="9599" />
        </Field>
        <span className="hidden sm:block" />
        <Field label="Max tables" required error={form.error("maxTables")}>
          <input {...form.text("maxTables")} inputMode="numeric" />
        </Field>
        <Field label="Max staff" required error={form.error("maxStaff")}>
          <input {...form.text("maxStaff")} inputMode="numeric" />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={form.formError} />
        </div>
      </form>
    </Modal>
  );
}
