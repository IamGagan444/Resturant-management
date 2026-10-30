import { db, type Prisma } from "@rms/db";
import type { QueuedCommand, SyncResult } from "@rms/contracts";
import type { Actor } from "@rms/domain";
import { AppError } from "../lib/errors";
import { bumpOrder, transitionItem } from "./items";
import { ackRequest, confirmSession, doneRequest, placeStaffOrder, setAvailability, type StaffActor } from "./staffActions";

type Result = SyncResult["results"][number];

/**
 * Run one queued staff command. Business refusals (403/404/409/422…) become REJECTED and are
 * recorded for the manager; anything else (DB down, bug) throws so the device keeps the command and retries.
 */
export async function runCommand(a: StaffActor & { deviceId: string | null }, q: QueuedCommand): Promise<Result> {
  const c = q.command;
  const actor = { role: a.role as Actor, staffId: a.staffId };
  try {
    let outcome: "APPLIED" | "NOOP";
    switch (c.type) {
      case "item.transition":
        outcome = await transitionItem(actor, c.orderItemId, c.to, c.reason);
        break;
      case "order.bump":
        outcome = (await bumpOrder(actor, c.orderId, null)) > 0 ? "APPLIED" : "NOOP";
        break;
      case "menu.availability":
        outcome = await setAvailability(a, c.menuItemId, c.isAvailable, new Date(q.clientTs));
        break;
      case "request.ack":
        outcome = await ackRequest(a, c.requestId);
        break;
      case "request.done":
        outcome = await doneRequest(a, c.requestId);
        break;
      case "session.confirm":
        outcome = await confirmSession(a, c.sessionId);
        break;
      case "order.create":
        outcome = (await placeStaffOrder(a, { clientId: q.clientId, tableId: c.tableId, lines: c.lines, note: c.note })).created ? "APPLIED" : "NOOP";
        break;
    }
    return { clientId: q.clientId, outcome };
  } catch (e) {
    const status = e instanceof AppError ? e.status : isRefusal(e) ? 400 : 500;
    if (status >= 500) throw e;
    const reason = e instanceof Error ? e.message : "Rejected";
    await db.syncRejection.create({
      data: { hotelId: a.hid, deviceId: a.deviceId, clientId: q.clientId, command: { ...q, staffId: a.staffId } as unknown as Prisma.InputJsonValue, reason },
    });
    return { clientId: q.clientId, outcome: "REJECTED", reason };
  }
}

/** Cross-tenant / unknown references from the data layer are refusals, not server faults. */
const isRefusal = (e: unknown) => e instanceof Error && (e.name === "TenantMismatchError" || ("code" in e && (e.code === "P2025" || e.code === "P2003")));

/** Commands run strictly in order: a later command may depend on an earlier one (create, then start cooking). */
export async function runCommands(a: StaffActor & { deviceId: string | null }, commands: readonly QueuedCommand[]): Promise<Result[]> {
  const results: Result[] = [];
  for (const q of commands) results.push(await runCommand(a, q));
  return results;
}
