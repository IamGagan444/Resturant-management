import type { Cart, Guest } from "./session";
import type { ItemStatus, RequestType, TableStatus } from "./enums";

/**
 * Socket.IO event contract.
 *
 * Events are HINTS: small payloads so clients can patch their query cache or refetch.
 * REST is the source of truth; on (re)connect every client refetches its screen state.
 *
 * Rooms
 *   h:{hotelId}:managers         OWNER/MANAGER devices
 *   h:{hotelId}:waiters          all WAITERs (fallback when table unassigned)
 *   h:{hotelId}:kitchen          every KDS screen (expo / all-stations view)
 *   h:{hotelId}:cashiers         CASHIER devices
 *   h:{hotelId}:station:{id}     KDS devices for a station
 *   h:{hotelId}:staff:{staffId}  one staff member (waiter alerts)
 *   h:{hotelId}:menu             public, customers' menu availability
 *   s:{sessionId}                guests at one table
 */

interface Base {
  hotelId: string;
  at: string; // ISO server time
}

export interface ServerToClientEvents {
  /** → s:{session} */
  "cart:updated": (e: Base & { sessionId: string; cart: Cart }) => void;
  /** → s:{session}, assigned waiter */
  "session:guest_joined": (e: Base & { sessionId: string; guest: Guest }) => void;
  /** → s:{session}, assigned waiter, managers */
  "session:confirmed": (e: Base & { sessionId: string; byStaffId: string }) => void;

  /** → each station touched, assigned waiter, managers, s:{session} */
  "order:placed": (
    e: Base & { orderId: string; sessionId: string; tableLabel: string; orderNumber: number; stationIds: string[] },
  ) => void;
  /** → assigned waiter, managers, s:{session} */
  "order:pending_confirmation": (e: Base & { orderId: string; sessionId: string; tableId: string; tableLabel: string }) => void;
  /** → stations, assigned waiter, managers, s:{session} */
  "order:cancelled": (e: Base & { orderId: string; sessionId: string; reason: string | null }) => void;

  /** → station, s:{session}, managers; assigned waiter when to = READY */
  "item:status_changed": (
    e: Base & {
      orderItemId: string;
      orderId: string;
      sessionId: string;
      stationId: string | null;
      from: ItemStatus;
      to: ItemStatus;
      updatedAt: string;
    },
  ) => void;
  /** → s:{session} (replacement prompt), assigned waiter */
  "item:out_of_stock": (e: Base & { orderItemId: string; orderId: string; sessionId: string; menuItemId: string }) => void;
  /** → h:{hotel}:menu, all stations, managers */
  "menu:item_availability": (e: Base & { menuItemId: string; isAvailable: boolean }) => void;

  /** → assigned waiter, managers, s:{session} */
  "request:created": (e: Base & { requestId: string; sessionId: string; tableLabel: string; type: RequestType }) => void;
  "request:acknowledged": (e: Base & { requestId: string; sessionId: string; byStaffId: string }) => void;
  "request:done": (e: Base & { requestId: string; sessionId: string }) => void;

  /** → managers, assigned waiter */
  "pickup:escalated": (e: Base & { orderItemId: string; tableLabel: string; itemName: string; waitingSec: number }) => void;

  /** → assigned waiter, cashiers, managers */
  "bill:requested": (e: Base & { sessionId: string; tableLabel: string }) => void;
  /** → s:{session}, cashiers: totals, splits or payments changed (refetch the bill) */
  "bill:updated": (e: Base & { billId: string; sessionId: string }) => void;
  /** → s:{session}, cashiers, assigned waiter, managers */
  "bill:paid": (e: Base & { billId: string; sessionId: string; receiptUrl: string }) => void;
  /** → managers, assigned waiter */
  "table:status_changed": (e: Base & { tableId: string; status: TableStatus }) => void;
}

export interface ClientToServerEvents {
  /** Customer only: subscribe to a session room. Server verifies the guest cookie. */
  "session:subscribe": (sessionId: string, ack: (ok: boolean) => void) => void;
}

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<E extends ServerEventName> = Parameters<ServerToClientEvents[E]>[0];

export const rooms = {
  managers: (hotelId: string) => `h:${hotelId}:managers`,
  /** all waiters on shift — fallback when a table has no assigned waiter */
  waiters: (hotelId: string) => `h:${hotelId}:waiters`,
  /** every KDS screen regardless of station (expo / "all stations" view) */
  kitchen: (hotelId: string) => `h:${hotelId}:kitchen`,
  cashiers: (hotelId: string) => `h:${hotelId}:cashiers`,
  station: (hotelId: string, stationId: string) => `h:${hotelId}:station:${stationId}`,
  staff: (hotelId: string, staffId: string) => `h:${hotelId}:staff:${staffId}`,
  menu: (hotelId: string) => `h:${hotelId}:menu`,
  session: (sessionId: string) => `s:${sessionId}`,
} as const;
