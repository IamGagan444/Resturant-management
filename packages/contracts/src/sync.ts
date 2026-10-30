import { z } from "zod";
import { ClientId, Id } from "./common";
import { ItemStatus, StaffRole } from "./enums";
import type { BoardTable, Me } from "./admin";
import type { KdsTicket, OrderItemView, OrderView, ServiceRequestView } from "./order";
import type { PublicMenu } from "./menu";

/**
 * Offline command queue for staff devices.
 * Every staff mutation is a command, so going offline only changes the transport:
 *   online   → POST /v1/s/sync to the cloud (one or many commands, in order)
 *   outage   → same commands to the local hub, which replays them to the cloud later
 *   offline  → kept in the device's IndexedDB queue until either is reachable
 * Commands are safe to replay: item status only moves forward, creates carry client ids,
 * availability is last-writer-wins by device time.
 */

/** Waiter-taken order. Line ids are client-generated so the hub and the cloud agree on item ids. */
export const StaffOrderLineCmd = z.object({
  id: z.string().uuid(),
  itemId: Id,
  variantId: Id.nullish(),
  addonIds: z.array(Id).default([]),
  quantity: z.number().int().min(1).max(50),
  note: z.string().trim().max(140).nullish(),
});

export const Command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("item.transition"), orderItemId: Id, to: ItemStatus, reason: z.string().max(140).optional() }),
  z.object({ type: z.literal("order.bump"), orderId: Id }),
  z.object({ type: z.literal("menu.availability"), menuItemId: Id, isAvailable: z.boolean() }),
  z.object({ type: z.literal("request.ack"), requestId: Id }),
  z.object({ type: z.literal("request.done"), requestId: Id }),
  z.object({ type: z.literal("session.confirm"), sessionId: Id }),
  z.object({
    type: z.literal("order.create"),
    tableId: Id,
    lines: z.array(StaffOrderLineCmd).min(1).max(100),
    note: z.string().trim().max(200).optional(),
  }),
]);
export type Command = z.infer<typeof Command>;

export const QueuedCommand = z.object({
  clientId: ClientId, // idempotency key of the action (also the order's clientId for order.create)
  clientTs: z.string().datetime(), // device clock; used only for last-writer-wins on availability toggles
  command: Command,
});
export type QueuedCommand = z.infer<typeof QueuedCommand>;

export const SyncInput = z.object({ commands: z.array(QueuedCommand).min(1).max(200) });
export type SyncInput = z.infer<typeof SyncInput>;

export const SyncOutcome = z.enum(["APPLIED", "NOOP", "REJECTED"]); // NOOP = already applied or superseded
export const SyncResult = z.object({
  results: z.array(z.object({ clientId: ClientId, outcome: SyncOutcome, reason: z.string().optional() })),
});
export type SyncResult = z.infer<typeof SyncResult>;

// ── Local hub ─────────────────────────────────

/** Hub replays commands on behalf of the staff member who tapped them on the LAN. */
export const HubQueuedCommand = QueuedCommand.extend({ staffId: Id });
export type HubQueuedCommand = z.infer<typeof HubQueuedCommand>;
export const HubSyncInput = z.object({ commands: z.array(HubQueuedCommand).min(1).max(500) });
export type HubSyncInput = z.infer<typeof HubSyncInput>;

/** POST /v1/admin/hub — pair the hub box. The token is shown once and goes into the hub's .env. */
export const HubPairInput = z.object({
  name: z.string().trim().min(1).max(40).default("Local hub"),
  url: z.string().url().max(200), // LAN URL devices reach it on, e.g. https://hub.spicegarden.example:4100
});
export type HubPairInput = z.infer<typeof HubPairInput>;

/** GET /v1/s/hub/pass — lets a signed-in device use the hub during an outage without logging in again. */
export interface HubPass {
  hubUrl: string | null;
  hotelId: string;
  pass: string | null; // JWT signed with the hub's key; null when no hub is set up
  expiresAt: string | null;
}

export const HubPassClaims = z.object({
  typ: z.literal("hubpass"),
  sub: Id, // staff id
  hid: Id,
  role: StaffRole,
  sid: Id.nullable(),
});
export type HubPassClaims = z.infer<typeof HubPassClaims>;

export interface HubStaff {
  id: string;
  name: string;
  role: z.infer<typeof StaffRole>;
  stationId: string | null;
}

/**
 * GET /v1/hub/snapshot — everything the kitchen and floor need to keep working on the LAN.
 * Shapes match the cloud's own responses so the console renders hub data unchanged.
 */
export interface HubSnapshot {
  generatedAt: string;
  hotel: Extract<Me, { typ: "staff" }>["hotel"] & { timezone: string };
  /** HMAC key the hub verifies device passes with (derived per hub; rotating the hub rotates it) */
  passKey: string;
  menu: PublicMenu;
  stations: { id: string; name: string; color: string | null }[];
  menuItems: { id: string; name: string; isAvailable: boolean; stationId: string | null; categoryId: string }[];
  staff: HubStaff[];
  tables: BoardTable[];
  /** tableId → staff ids assigned today */
  assignments: Record<string, string[]>;
  /** released orders with anything still to cook, carry or swap */
  orders: KdsTicket[];
  pendingOrders: OrderView[];
  requests: ServiceRequestView[];
}

/** GET /hub/health on the hub (no auth): consoles probe it to decide whether to fail over. */
export interface HubHealth {
  ok: true;
  hotelId: string | null;
  cloudOnline: boolean;
  lastSyncAt: string | null;
  pending: number;
}

/** Waiter board as served by the cloud and the hub. */
export interface WaiterBoard {
  tables: BoardTable[];
  ready: (OrderItemView & { sessionId: string; orderNumber: number })[];
  pendingOrders: OrderView[];
  requests: ServiceRequestView[];
}

