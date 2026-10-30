import type { ServerOptions as HttpsOptions } from "node:https";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { jwtVerify } from "jose";
import { Server } from "socket.io";
import { HubPassClaims, SyncInput, type ClientToServerEvents, type HubHealth, type Me, type ServerToClientEvents, type StaffRole, type SyncResult } from "@rms/contracts";
import { CloudLink } from "./cloud";
import { applyCommand, boardView, kdsView, type HubActor, type HubEvent } from "./state";
import { Store } from "./store";

export interface HubOptions {
  cloudUrl: string;
  token: string;
  /** state file; null keeps everything in memory (tests) */
  dataFile: string | null;
  /** console origins allowed to call the hub from the browser */
  origins: string[];
  pollMs: number;
  https?: HttpsOptions;
  log?: boolean;
}

const KITCHEN: StaffRole[] = ["OWNER", "MANAGER", "COOK"];
const FLOOR: StaffRole[] = ["OWNER", "MANAGER", "WAITER"];

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The local hub: serves the kitchen and floor screens on the restaurant LAN while the internet is down.
 * It speaks the same paths and shapes as the cloud for what the kitchen and waiters need, so the console
 * only swaps its base URL. Everything else answers 503 NEEDS_INTERNET.
 */
export async function createHub(opts: HubOptions) {
  const store = new Store(opts.dataFile);
  await store.load();
  const link = new CloudLink({ cloudUrl: opts.cloudUrl, token: opts.token, log: opts.log ? (m) => app.log.info(m) : undefined }, store);

  const app: FastifyInstance = opts.https
    ? (Fastify({ logger: opts.log ?? false, https: opts.https }) as unknown as FastifyInstance) // https server typing differs only in the raw server type
    : Fastify({ logger: opts.log ?? false });

  // Chrome's Private Network Access: a page on the public internet may call a LAN address only if it opts in.
  app.addHook("onRequest", async (req, reply) => {
    if (req.headers["access-control-request-private-network"]) reply.header("access-control-allow-private-network", "true");
  });
  await app.register(cors, { origin: opts.origins, credentials: false, allowedHeaders: ["authorization", "content-type"] });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: { code: status >= 500 ? "INTERNAL" : "BAD_REQUEST", message: err.message } });
  });

  async function identify(token: string | undefined): Promise<HubActor & { name: string }> {
    const snap = store.state.snapshot;
    if (!snap) throw new HttpError(503, "HUB_NOT_READY", "The hub hasn't synced with the cloud yet");
    if (!token) throw new HttpError(401, "UNAUTHORIZED", "Not signed in");
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(snap.passKey), { algorithms: ["HS256"] });
      const claims = HubPassClaims.parse({ ...payload, sub: payload.sub });
      const person = snap.staff.find((s) => s.id === claims.sub);
      if (claims.hid !== snap.hotel.id || !person) throw new Error("not this hotel");
      return { staffId: person.id, name: person.name, role: person.role, sid: claims.sid };
    } catch {
      throw new HttpError(401, "UNAUTHORIZED", "Sign in again when the internet is back");
    }
  }

  const bearer = (req: FastifyRequest) => (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);

  function guard(roles: StaffRole[] | null, handler: (req: FastifyRequest, reply: FastifyReply, who: HubActor & { name: string }) => unknown) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const who = await identify(bearer(req));
      if (roles && !roles.includes(who.role)) throw new HttpError(403, "FORBIDDEN", "Not allowed");
      return handler(req, reply, who);
    };
  }

  const snap = () => {
    const s = store.state.snapshot;
    if (!s) throw new HttpError(503, "HUB_NOT_READY", "The hub hasn't synced with the cloud yet");
    return s;
  };

  app.get("/hub/health", async (): Promise<HubHealth> => ({
    ok: true,
    hotelId: store.state.snapshot?.hotel.id ?? null,
    cloudOnline: link.online,
    lastSyncAt: store.state.lastSyncAt,
    pending: store.state.outbox.length,
  }));

  app.get(
    "/v1/auth/me",
    guard(null, async (_req, _reply, who): Promise<Me> => {
      const { hotel } = snap();
      return { typ: "staff", id: who.staffId, name: who.name, role: who.role, hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug }, deviceId: null, stationId: who.sid };
    }),
  );
  app.get("/v1/s/menu", guard(null, async () => snap().menu));
  app.get("/v1/s/stations", guard(null, async () => snap().stations));
  app.get("/v1/s/menu-items", guard(KITCHEN, async () => snap().menuItems));
  app.get(
    "/v1/s/kds",
    guard(KITCHEN, async (req, _reply, who) => {
      const station = (req.query as { station?: string }).station;
      return kdsView(snap(), station === "all" ? null : (station ?? who.sid));
    }),
  );
  app.get(
    "/v1/s/waiter/board",
    guard(FLOOR, async (_req, _reply, who) => boardView(snap(), who.role === "WAITER" ? who.staffId : null)),
  );

  /** The same command endpoint as the cloud. Applied here at once, replayed to the cloud when it's reachable. */
  app.post(
    "/v1/s/sync",
    guard(null, async (req, _reply, who): Promise<SyncResult> => {
      const parsed = SyncInput.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "VALIDATION", "Invalid input");
      const results: SyncResult["results"] = [];
      const events: HubEvent[] = [];
      for (const q of parsed.data.commands) {
        const r = applyCommand(store.state, who, q);
        results.push({ clientId: q.clientId, outcome: r.outcome, ...(r.reason ? { reason: r.reason } : {}) });
        events.push(...r.events);
      }
      store.save();
      broadcast(events);
      if (link.online) void link.tick(); // cloud is back: don't wait for the next poll
      return { results };
    }),
  );

  // Billing, payments, menu editing and reports need the cloud.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/v1/")) {
      return reply.status(503).send({ error: { code: "NEEDS_INTERNET", message: "This needs the internet. It works again as soon as the connection is back." } });
    }
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  // ── Realtime on the LAN: same event names as the cloud; few devices, so every event goes to everyone ──
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, { path: "/socket.io", cors: { origin: opts.origins } });
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string }).token;
    identify(token).then(
      () => next(),
      () => next(new Error("UNAUTHORIZED")),
    );
  });
  function broadcast(events: HubEvent[]) {
    const at = new Date().toISOString();
    for (const e of events) (io.emit as (ev: string, payload: unknown) => boolean)(e.event, { ...e.payload, at });
  }

  let timer: NodeJS.Timeout | null = null;
  return {
    app,
    io,
    store,
    link,
    async start(port: number, host = "0.0.0.0") {
      await link.tick();
      timer = setInterval(() => void link.tick(), opts.pollMs);
      return app.listen({ port, host });
    },
    async close() {
      if (timer) clearInterval(timer);
      io.close();
      await app.close();
      await store.flush();
    },
  };
}
