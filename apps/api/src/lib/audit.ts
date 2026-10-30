import { currentHotelId, db, type Prisma, type Tx } from "@rms/db";
import type { AuditAction } from "@rms/contracts";

export type { AuditAction };

/** Must run inside withTenant(). Pass `tx` to keep the log atomic with the change. */
export async function audit(
  actorId: string | null,
  action: AuditAction,
  entity: string,
  entityId: string,
  meta?: Prisma.InputJsonValue,
  tx?: Tx,
) {
  const hotelId = currentHotelId();
  if (!hotelId) throw new Error("audit() called outside tenant context");
  await (tx ?? db).auditLog.create({ data: { hotelId, actorId, action, entity, entityId, meta } });
}
