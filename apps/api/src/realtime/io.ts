import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import fastifyCookie from "@fastify/cookie";
import {
  rooms,
  type ClientToServerEvents,
  type ServerEventName,
  type ServerEventPayload,
  type ServerToClientEvents,
} from "@rms/contracts";
import { env } from "../env";
import { COOKIE, verifyAccessToken, verifyGuestToken } from "../lib/auth";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
let io: IO | null = null;

/**
 * Rooms are joined server-side from the verified token; clients never choose their rooms.
 * Socket events are hints — clients refetch on (re)connect.
 */
export function initRealtime(httpServer: HttpServer): IO {
  const server: IO = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: [env.CUSTOMER_URL, env.CONSOLE_URL], credentials: true },
  });
  const pub = new Redis(env.REDIS_URL);
  const sub = pub.duplicate();
  server.adapter(createAdapter(pub, sub));

  server.use(async (socket, next) => {
    const cookies = fastifyCookie.parse(socket.handshake.headers.cookie ?? "");
    const auth = socket.handshake.auth as { token?: string; guestToken?: string };
    const staffToken = auth.token ?? cookies[COOKIE.access];
    const guestToken = auth.guestToken ?? cookies[COOKIE.guest];

    const claims = staffToken ? await verifyAccessToken(staffToken) : null;
    if (claims?.typ === "staff") {
      const h = claims.hid;
      const join = [rooms.staff(h, claims.sub)];
      if (claims.role === "OWNER" || claims.role === "MANAGER") join.push(rooms.managers(h), rooms.cashiers(h), rooms.kitchen(h));
      if (claims.role === "CASHIER") join.push(rooms.cashiers(h));
      if (claims.role === "WAITER") join.push(rooms.waiters(h));
      // Kitchen events go to the kitchen room with `stationIds`; each KDS filters for its station.
      if (claims.role === "COOK") join.push(rooms.kitchen(h), ...(claims.sid ? [rooms.station(h, claims.sid)] : []));
      await socket.join(join);
      socket.data.kind = "staff";
      return next();
    }
    if (claims?.typ === "platform") {
      socket.data.kind = "platform";
      return next();
    }
    const g = guestToken ? await verifyGuestToken(guestToken) : null;
    if (g) {
      await socket.join([rooms.session(g.ses), rooms.menu(g.hid)]);
      socket.data.kind = "guest";
      socket.data.sessionId = g.ses;
      return next();
    }
    next(new Error("UNAUTHORIZED"));
  });

  server.on("connection", (socket) => {
    socket.on("session:subscribe", (sessionId, ack) => ack(socket.data.sessionId === sessionId));
  });

  io = server;
  return server;
}

/** Typed emit. No-op when realtime isn't initialised (unit/integration tests using inject). */
export function emit<E extends ServerEventName>(
  event: E,
  to: readonly string[],
  payload: Omit<ServerEventPayload<E>, "at">,
): void {
  if (!io || to.length === 0) return;
  const full = { ...payload, at: new Date().toISOString() } as ServerEventPayload<E>;
  const args = [full] as unknown as Parameters<ServerToClientEvents[E]>;
  io.to([...new Set(to)]).emit(event, ...args);
}

export async function closeRealtime() {
  await io?.close();
  io = null;
}
