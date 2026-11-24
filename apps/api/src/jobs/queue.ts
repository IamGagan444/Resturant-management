import { Queue } from "bullmq";
import { createRedis } from "../lib/redis";

export const redis = createRedis("main", { maxRetriesPerRequest: null });

export const QUEUE = "rms";
export const queue = new Queue(QUEUE, { connection: redis });
queue.on("error", () => {}); // connection errors are logged by createRedis

export type JobData =
  | { kind: "pickup-escalation"; hotelId: string; orderItemId: string }
  | { kind: "maintenance" }
  | { kind: "alerts"; hotelId?: string } // one restaurant, or all of them
  | { kind: "alert-test"; hotelId: string; subscriptionId: string };

// BullMQ job ids must not contain ':'.
const pickupJobId = (orderItemId: string) => `pickup-${orderItemId}`;

/** Deterministic job id: re-scheduling the same item is a no-op, removal is exact. */
export async function schedulePickupEscalation(hotelId: string, orderItemId: string, delaySec: number) {
  await queue.add(
    "pickup-escalation",
    { kind: "pickup-escalation", hotelId, orderItemId } satisfies JobData,
    { jobId: pickupJobId(orderItemId), delay: delaySec * 1000, removeOnComplete: true, removeOnFail: 100 },
  );
}

export async function cancelPickupEscalation(orderItemId: string) {
  await queue.remove(pickupJobId(orderItemId));
}

/**
 * Something new is waiting: ring phones now instead of at the next tick. Deterministic id, so a burst of events is
 * one sweep. Best effort (never holds up the order): the repeating sweep catches anything missed.
 */
export function nudgeAlerts(hotelId: string) {
  void queue
    .add("alerts", { kind: "alerts", hotelId } satisfies JobData, { jobId: `alerts-${hotelId}`, delay: 500, removeOnComplete: true, removeOnFail: true })
    .catch(() => undefined);
}

export async function scheduleTestAlert(hotelId: string, subscriptionId: string) {
  await queue.add("alert-test", { kind: "alert-test", hotelId, subscriptionId } satisfies JobData, { delay: 8000, removeOnComplete: true, removeOnFail: true });
}

export async function closeQueue() {
  await queue.close();
  redis.disconnect();
}
