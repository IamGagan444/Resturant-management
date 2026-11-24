import { z } from "zod";

/**
 * Browsers' push services. The server POSTs to the address a browser hands over, so only these are accepted:
 * anything else could point it at an internal machine.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];

export const PushEndpoint = z
  .string()
  .max(1000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && u.port === "" && u.username === "" && u.password === "" && PUSH_HOSTS.some((h) => h.test(u.hostname));
    } catch {
      return false;
    }
  }, "This browser's alert service isn't supported");

const B64Url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);
export const PushSubscribeInput = z.object({
  endpoint: PushEndpoint,
  keys: z.object({ p256dh: B64Url.min(80).max(100), auth: B64Url.min(20).max(30) }),
});
export const PushEndpointInput = z.object({ endpoint: PushEndpoint });
export const PushPauseInput = z.object({ endpoint: PushEndpoint, paused: z.boolean() });
export interface PushState {
  paused: boolean;
}
/** What the service worker shows. No guest names, phones or amounts: it appears on a locked screen. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}
