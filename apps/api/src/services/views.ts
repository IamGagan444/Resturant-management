import type { Prisma } from "@rms/db";
import type { OrderItemView, OrderView, ServiceRequestView } from "@rms/contracts";

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const orderInclude = {
  items: { include: { addons: true }, orderBy: { id: "asc" } },
  session: { select: { tableId: true, table: { select: { label: true } } } },
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
    tableLabel: o.session.table.label,
    orderNumber: o.orderNumber,
    source: o.source,
    status: o.status,
    note: o.note,
    etaAt: iso(o.etaAt),
    placedAt: o.placedAt.toISOString(),
    items: o.items.map(toOrderItemView),
  };
}

export const requestInclude = { session: { select: { table: { select: { label: true } } } } } satisfies Prisma.ServiceRequestInclude;
type RequestWithTable = Prisma.ServiceRequestGetPayload<{ include: typeof requestInclude }>;

export function toRequestView(r: RequestWithTable): ServiceRequestView {
  return {
    id: r.id,
    sessionId: r.sessionId,
    tableLabel: r.session.table.label,
    type: r.type,
    note: r.note,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}
