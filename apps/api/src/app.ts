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
import { rateLimitKey } from "./lib/auth";
import { redactUrl, registerSecurity } from "./lib/security";
import { redis } from "./jobs/queue";
import { authRoutes } from "./routes/auth";
import { loginRoutes } from "./routes/login";
import { platformRoutes } from "./routes/platform";
import { adminRoutes } from "./routes/admin";
import { menuAdminRoutes } from "./routes/menuAdmin";
import { publicRoutes } from "./routes/public";
import { staffRoutes } from "./routes/staff";
import { paymentRoutes } from "./routes/payments";
import { hubRoutes } from "./routes/hub";

export async function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            level: env.NODE_ENV === "production" ? "info" : "debug",
            // default request serializer minus secrets that live in URLs (receipt links, QR tokens)
            serializers: {
              req: (req) => ({ method: req.method, url: redactUrl(req.url), host: req.host, remoteAddress: req.ip }),
            },
          },
    // Only a proxy on this machine / the private network (Caddy in docker compose) may set X-Forwarded-For.
    // `true` would let any client spoof its IP and get a fresh rate-limit budget per request.
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  // gzip/brotli JSON over 1 KB: the menu and kitchen lists are the big ones on slow 4G
  await app.register(compress, { threshold: 1024 });
  await app.register(cookie);
  await registerSecurity(app); // after cookie: the CSRF check reads parsed cookies
  await app.register(cors, {
    origin: [env.CUSTOMER_URL, env.CONSOLE_URL],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "authorization", "x-guest-token", "if-none-match"],
  });
  // one file per request, 8 MB, no stray fields: only the menu-photo upload uses multipart
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5, parts: 6 } });
  // Shared Redis store so limits hold across API instances. Counted per signed-in person / guest, or per IP
  // when anonymous (see rateLimitKey): a whole restaurant behind one Wi-Fi must not share one budget.
  await app.register(rateLimit, {
    global: true,
    keyGenerator: rateLimitKey,
    max: env.NODE_ENV === "test" ? 10_000 : (_req, key) => (key.startsWith("ip:") ? 300 : 600),
    timeWindow: "1 minute",
    redis: env.NODE_ENV === "test" ? undefined : redis,
    skipOnError: true,
  });
  if (env.STORAGE_DRIVER === "local") {
    await app.register(fastifyStatic, { root: path.resolve(env.UPLOAD_DIR), prefix: "/uploads/", decorateReply: false });
  }

  app.setErrorHandler(errorHandler);
  app.get("/health", async () => ({ ok: true }));

  await app.register(loginRoutes);
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
