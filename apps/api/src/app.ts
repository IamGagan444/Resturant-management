import path from "node:path";
import Fastify from "fastify";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { env } from "./env";
import { errorHandler } from "./lib/errors";
import { redis } from "./jobs/queue";
import { authRoutes } from "./routes/auth";
import { platformRoutes } from "./routes/platform";
import { adminRoutes } from "./routes/admin";
import { menuAdminRoutes } from "./routes/menuAdmin";
import { publicRoutes } from "./routes/public";
import { staffRoutes } from "./routes/staff";
import { paymentRoutes } from "./routes/payments";
import { hubRoutes } from "./routes/hub";

export async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : { level: env.NODE_ENV === "production" ? "info" : "debug" },
    trustProxy: true,
  });

  // gzip/brotli JSON over 1 KB: the menu and kitchen lists are the big ones on slow 4G
  await app.register(compress, { threshold: 1024 });
  await app.register(cookie);
  await app.register(cors, { origin: [env.CUSTOMER_URL, env.CONSOLE_URL], credentials: true });
  await app.register(multipart);
  // Shared Redis store so limits hold across API instances. Public QR routes are the main target.
  await app.register(rateLimit, {
    global: true,
    max: env.NODE_ENV === "test" ? 10_000 : 300,
    timeWindow: "1 minute",
    redis: env.NODE_ENV === "test" ? undefined : redis,
    skipOnError: true,
  });
  if (env.STORAGE_DRIVER === "local") {
    await app.register(fastifyStatic, { root: path.resolve(env.UPLOAD_DIR), prefix: "/uploads/", decorateReply: false });
  }

  app.setErrorHandler(errorHandler);
  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(platformRoutes);
  await app.register(adminRoutes);
  await app.register(menuAdminRoutes);
  await app.register(publicRoutes);
  await app.register(staffRoutes);
  await app.register(paymentRoutes);
  await app.register(hubRoutes);
  return app;
}
