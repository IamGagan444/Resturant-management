import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../env";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const QUEUE = "rms";
export const queue = new Queue(QUEUE, { connection: redis });

export type JobData =
  | { kind: "pickup-escalation"; hotelId: string; orderItemId: string }
  | { kind: "maintenance" };

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

export async function closeQueue() {
  await queue.close();
  redis.disconnect();
}
