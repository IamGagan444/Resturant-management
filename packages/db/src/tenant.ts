import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";

/**
 * Tenant isolation.
 *
 * Every request handler that touches tenant data runs inside `withTenant(hotelId, fn)`.
 * The Prisma extension below then:
 *  - adds `hotelId` to every `where` (reads, updates, deletes, counts, aggregates)
 *  - stamps `hotelId` on every create, and rejects a create/update carrying a different one
 *  - throws if a tenant model is queried with no tenant context at all
 *
 * Rules for service code:
 *  - Use scalar FKs (`sessionId: x`), not `connect`, so the injected `hotelId` scalar is valid input.
 *  - Nested creates bypass the top-level hook; their input types require `hotelId`, pass `ctx.hotelId`.
 *  - `$queryRaw` / `$executeRaw` are NOT scoped. Always filter by hotelId by hand.
 *  - Platform / bootstrap lookups (resolve hotel by slug, login) use `unscopedDb` explicitly.
 */

interface TenantContext {
  hotelId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function withTenant<T>(hotelId: string, fn: () => T): T {
  return storage.run({ hotelId }, fn);
}

export function currentHotelId(): string | undefined {
  return storage.getStore()?.hotelId;
}

export const NON_TENANT_MODELS: ReadonlySet<string> = new Set([
  "PlatformUser",
  "Plan",
  "Hotel",
  "RefreshToken",
  "WebhookEvent",
]);

export class TenantContextMissingError extends Error {
  constructor(model: string, operation: string) {
    super(`Tenant context missing for ${model}.${operation}. Wrap the call in withTenant().`);
    this.name = "TenantContextMissingError";
  }
}

export class TenantMismatchError extends Error {
  constructor(model: string) {
    super(`hotelId in ${model} input does not match the current tenant.`);
    this.name = "TenantMismatchError";
  }
}

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
const UPDATE_OPS = new Set(["update", "updateMany", "updateManyAndReturn"]);

type Args = Record<string, unknown>;

function isRecord(v: unknown): v is Args {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scopeWhere(model: string, where: unknown, hotelId: string): Args {
  const w = isRecord(where) ? where : {};
  if (w.hotelId !== undefined && w.hotelId !== hotelId) throw new TenantMismatchError(model);
  return { ...w, hotelId };
}

function stampCreate(model: string, data: unknown, hotelId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => stampCreate(model, d, hotelId));
  if (!isRecord(data)) return data;
  if ("hotel" in data) {
    throw new Error(`${model}: pass hotelId implicitly via tenant context, not a 'hotel' relation input.`);
  }
  if (data.hotelId !== undefined && data.hotelId !== hotelId) throw new TenantMismatchError(model);
  return { ...data, hotelId };
}

function guardUpdate(model: string, data: unknown, hotelId: string): void {
  if (!isRecord(data)) return;
  if ("hotel" in data) throw new TenantMismatchError(model);
  if (data.hotelId !== undefined && data.hotelId !== hotelId) throw new TenantMismatchError(model);
}

/** Pure arg rewriter, exported for unit tests. Returns args unchanged for non-tenant models. */
export function scopeArgs(model: string, operation: string, args: unknown, hotelId: string | undefined): Args {
  const a: Args = isRecord(args) ? { ...args } : {};
  if (NON_TENANT_MODELS.has(model)) return a;
  if (!hotelId) throw new TenantContextMissingError(model, operation);

  if (WHERE_OPS.has(operation)) a.where = scopeWhere(model, a.where, hotelId);
  if (UPDATE_OPS.has(operation)) guardUpdate(model, a.data, hotelId);
  if (CREATE_OPS.has(operation)) a.data = stampCreate(model, a.data, hotelId);
  if (operation === "upsert") {
    a.where = scopeWhere(model, a.where, hotelId);
    a.create = stampCreate(model, a.create, hotelId);
    guardUpdate(model, a.update, hotelId);
  }
  return a;
}

export const tenantExtension = Prisma.defineExtension({
  name: "tenant",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // `args` is a per-operation union; scopeArgs only adds/validates hotelId, so the shape is preserved.
        return query(scopeArgs(model, operation, args, currentHotelId()) as typeof args);
      },
    },
  },
});
