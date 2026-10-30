import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@rms/db";
import type { z } from "zod";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = "Not signed in") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Not allowed") => new AppError(403, "FORBIDDEN", message);
export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);

/** Validate untrusted input. Throws 400 VALIDATION with field errors. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError(400, "VALIDATION", "Invalid input", r.error.flatten());
  return r.data;
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });
    if (err.code === "P2002")
      return reply.status(409).send({ error: { code: "CONFLICT", message: "Already exists", details: err.meta } });
    if (err.code === "P2003")
      return reply.status(409).send({ error: { code: "IN_USE", message: "Still referenced by other records" } });
  }
  if (err.name === "TenantMismatchError") {
    return reply.status(400).send({ error: { code: "TENANT_MISMATCH", message: "Invalid reference" } });
  }
  const status = "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
  if (status < 500) {
    return reply.status(status).send({ error: { code: "code" in err ? String(err.code) : "BAD_REQUEST", message: err.message } });
  }
  req.log.error(err);
  return reply.status(500).send({ error: { code: "INTERNAL", message: "Something went wrong" } });
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
