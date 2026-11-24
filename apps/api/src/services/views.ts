import type { Prisma } from "@rms/db";
import { parcelLabel } from "@rms/domain";
import type { OrderItemView, OrderView, ServiceRequestView } from "@rms/contracts";

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Where an order goes: the table's name, or the token of a walk-in parcel. */
export const sessionLabel = (s: { parcelNo: number | null; table: { label: string } }) => (s.parcelNo === null ? s.table.label : parcelLabel(s.parcelNo));

export const orderInclude = {
  items: { include: { addons: true }, orderBy: { id: "asc" } },
  session: { select: { tableId: true, parcelNo: true, table: { select: { label: true } } } },
} satisfies Prisma.OrderInclude;

export type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type ItemWithAddons = OrderWithItems["items"][number];

export function toOrderItemView(i: ItemWithAddons): OrderItemView {
  return {
    id: i.id,
    orderId: i.orderId,
    itemId: i.itemId,
    guestId: i.guestId,
    stationId: i.stationId,
    name: i.nameSnapshot,
    variantName: i.variantName,
    addons: i.addons.map((a) => ({ name: a.nameSnapshot, price: a.price })),
    unitPrice: i.unitPrice,
    quantity: i.quantity,
    note: i.note,
    isParcel: i.isParcel,
    status: i.status,
    startedAt: iso(i.startedAt),
    readyAt: iso(i.readyAt),
    pickedUpAt: iso(i.pickedUpAt),
    servedAt: iso(i.servedAt),
    updatedAt: i.updatedAt.toISOString(),
  };
}

export function toOrderView(o: OrderWithItems): OrderView {
  return {
    id: o.id,
    sessionId: o.sessionId,
    tableId: o.session.tableId,
    tableLabel: sessionLabel(o.session),
    orderNumber: o.orderNumber,
    source: o.source,
    status: o.status,
    note: o.note,
    etaAt: iso(o.etaAt),
    placedAt: o.placedAt.toISOString(),
    items: o.items.map(toOrderItemView),
  };
}

export const requestInclude = { session: { select: { tableId: true, parcelNo: true, table: { select: { label: true } } } } } satisfies Prisma.ServiceRequestInclude;
type RequestWithTable = Prisma.ServiceRequestGetPayload<{ include: typeof requestInclude }>;

export function toRequestView(r: RequestWithTable): ServiceRequestView {
  return {
    id: r.id,
    sessionId: r.sessionId,
    tableId: r.session.tableId,
    tableLabel: sessionLabel(r.session),
    type: r.type,
    note: r.note,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}
