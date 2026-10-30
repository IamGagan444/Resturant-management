import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { z } from "zod";
import { db, type Prisma } from "@rms/db";
import {
  AssignmentsInput,
  FloorInput,
  HotelSettingsInput,
  Id,
  ResetPinInput,
  StaffCreateInput,
  StaffUpdateInput,
  StationInput,
  TableInput,
  TablePositionsInput,
  AuditAction,
  type AuditPage,
  type SyncRejectionView,
  TaxInput,
} from "@rms/contracts";
import { env } from "../env";
import { audit } from "../lib/audit";
import { revokeAllFor } from "../lib/auth";
import { encrypt, hashSecret } from "../lib/crypto";
import { badRequest, conflict, forbidden, notFound, parse } from "../lib/errors";
import { businessDay, getHotel, invalidateHotel } from "../lib/hotel";
import { assertOwned } from "../lib/owned";
import { MANAGERS, staff } from "../lib/route";
import { saveImage, toWebp } from "../lib/storage";
import { invalidateMenu } from "../services/menu";

const IdParam = z.object({ id: Id });

export const qrUrl = (slug: string, qrToken: string) => `${env.CUSTOMER_URL}/h/${slug}/t/${qrToken}`;

export async function adminRoutes(app: FastifyInstance) {
  // Any menu / settings write changes what guests see: drop cached menus before the response goes out.
  app.addHook("onSend", async (req, _reply, payload) => {
    if (req.method !== "GET") invalidateMenu();
    return payload;
  });
  // ── Hotel settings ────────────────────────────
  app.get(
    "/v1/admin/hotel",
    staff(MANAGERS, async (_req, _reply, ctx) => {
      const h = await getHotel(ctx.hid);
      const { razorpayKeySecretEnc, razorpayWebhookSecretEnc, ...safe } = h;
      return { ...safe, razorpayConfigured: Boolean(h.razorpayKeyId && razorpayKeySecretEnc && razorpayWebhookSecretEnc) };
    }),
  );

  app.patch(
    "/v1/admin/hotel",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const { razorpay, ...rest } = parse(HotelSettingsInput, req.body);
      const data: Prisma.HotelUpdateInput = { ...rest };
      if (razorpay) {
        data.razorpayKeyId = razorpay.keyId;
        data.razorpayKeySecretEnc = encrypt(razorpay.keySecret);
        data.razorpayWebhookSecretEnc = encrypt(razorpay.webhookSecret);
      }
      // Hotel is not a tenant model; scope by the caller's hotel explicitly.
      await db.hotel.update({ where: { id: ctx.hid }, data });
      invalidateHotel(ctx.hid);
      return { ok: true };
    }),
  );

  // ── Taxes / stations / floors (simple CRUD) ──
  app.get("/v1/admin/taxes", staff(MANAGERS, async () => db.tax.findMany({ orderBy: { name: "asc" } })));
  app.post(
    "/v1/admin/taxes",
    staff(MANAGERS, async (req, reply, ctx) => {
      reply.status(201);
      return db.tax.create({ data: { hotelId: ctx.hid, ...parse(TaxInput, req.body) } });
    }),
  );
  app.patch(
    "/v1/admin/taxes/:id",
    staff(MANAGERS, async (req) => db.tax.update({ where: { id: parse(IdParam, req.params).id }, data: parse(TaxInput.partial(), req.body) })),
  );
  app.delete(
    "/v1/admin/taxes/:id",
    staff(MANAGERS, async (req) => {
      await db.tax.delete({ where: { id: parse(IdParam, req.params).id } });
      return { ok: true };
    }),
  );

  app.get("/v1/admin/stations", staff(MANAGERS, async () => db.station.findMany({ orderBy: { name: "asc" } })));
  app.post(
    "/v1/admin/stations",
    staff(MANAGERS, async (req, reply, ctx) => {
      const input = parse(StationInput, req.body);
      reply.status(201);
      return db.station.create({ data: { hotelId: ctx.hid, name: input.name, color: input.color ?? null } });
    }),
  );
  app.patch(
    "/v1/admin/stations/:id",
    staff(MANAGERS, async (req) =>
      db.station.update({ where: { id: parse(IdParam, req.params).id }, data: parse(StationInput.partial(), req.body) }),
    ),
  );
  app.delete(
    "/v1/admin/stations/:id",
    staff(MANAGERS, async (req) => {
      await db.station.delete({ where: { id: parse(IdParam, req.params).id } });
      return { ok: true };
    }),
  );

  app.get("/v1/admin/floors", staff(MANAGERS, async () => db.floor.findMany({ orderBy: { sortOrder: "asc" } })));
  app.post(
    "/v1/admin/floors",
    staff(MANAGERS, async (req, reply, ctx) => {
      reply.status(201);
      return db.floor.create({ data: { hotelId: ctx.hid, ...parse(FloorInput, req.body) } });
    }),
  );
  app.patch(
    "/v1/admin/floors/:id",
    staff(MANAGERS, async (req) => db.floor.update({ where: { id: parse(IdParam, req.params).id }, data: parse(FloorInput.partial(), req.body) })),
  );
  app.delete(
    "/v1/admin/floors/:id",
    staff(MANAGERS, async (req) => {
      await db.floor.delete({ where: { id: parse(IdParam, req.params).id } });
      return { ok: true };
    }),
  );

  // ── Tables & QR ───────────────────────────────
  app.get(
    "/v1/admin/tables",
    staff(MANAGERS, async (_req, _reply, ctx) => {
      const hotel = await getHotel(ctx.hid);
      const tables = await db.table.findMany({ orderBy: [{ floorId: "asc" }, { label: "asc" }] });
      return tables.map((t) => ({ ...t, qrUrl: qrUrl(hotel.slug, t.qrToken) }));
    }),
  );
  app.post(
    "/v1/admin/tables",
    staff(MANAGERS, async (req, reply, ctx) => {
      const input = parse(TableInput, req.body);
      await assertOwned("floor", [input.floorId]);
      reply.status(201);
      return db.table.create({ data: { hotelId: ctx.hid, ...input, floorId: input.floorId ?? null } });
    }),
  );
  app.patch(
    "/v1/admin/tables/:id",
    staff(MANAGERS, async (req) => {
      const input = parse(TableInput.partial(), req.body);
      await assertOwned("floor", [input.floorId]);
      return db.table.update({ where: { id: parse(IdParam, req.params).id }, data: input });
    }),
  );
  /** Floor-map editor saves every moved table at once (positions are % of the floor canvas). */
  app.put(
    "/v1/admin/tables/positions",
    staff(MANAGERS, async (req) => {
      const { tables } = parse(TablePositionsInput, req.body);
      await assertOwned("table", tables.map((t) => t.id));
      await db.$transaction(tables.map((t) => db.table.update({ where: { id: t.id }, data: { posX: t.posX, posY: t.posY } })));
      return { ok: true };
    }),
  );
  app.delete(
    "/v1/admin/tables/:id",
    staff(MANAGERS, async (req) => {
      const { id } = parse(IdParam, req.params);
      const used = await db.tableSession.count({ where: { tableId: id } });
      // Tables with history are deactivated, never deleted, so old bills keep their table.
      if (used) await db.table.update({ where: { id }, data: { isActive: false } });
      else await db.table.delete({ where: { id } });
      return { ok: true, deactivated: used > 0 };
    }),
  );
  /** Invalidate a printed QR (e.g. photographed and abused). */
  app.post(
    "/v1/admin/tables/:id/rotate-qr",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const t = await db.table.update({ where: { id }, data: { qrToken: randomBytes(12).toString("base64url") } });
      await audit(ctx.sub, "QR_ROTATED", "Table", id);
      return { ...t, qrUrl: qrUrl((await getHotel(ctx.hid)).slug, t.qrToken) };
    }),
  );
  /** Printable A4 sheet, 6 QR cards per page. */
  app.get(
    "/v1/admin/tables/qr-sheet.pdf",
    staff(MANAGERS, async (req, reply, ctx) => {
      const { floorId } = parse(z.object({ floorId: Id.optional() }), req.query);
      const hotel = await getHotel(ctx.hid);
      const tables = await db.table.findMany({
        where: { isActive: true, ...(floorId ? { floorId } : {}) },
        orderBy: { label: "asc" },
      });
      const pdf = await qrSheet(hotel.name, tables.map((t) => ({ label: t.label, url: qrUrl(hotel.slug, t.qrToken) })));
      return reply.header("content-type", "application/pdf").header("content-disposition", 'inline; filename="table-qr.pdf"').send(pdf);
    }),
  );

  // ── Staff ─────────────────────────────────────
  const staffSelect = {
    id: true,
    name: true,
    phone: true,
    email: true,
    role: true,
    language: true,
    isActive: true,
    stationId: true,
    createdAt: true,
  } satisfies Prisma.StaffSelect;

  app.get("/v1/admin/staff", staff(MANAGERS, async () => db.staff.findMany({ select: staffSelect, orderBy: [{ role: "asc" }, { name: "asc" }] })));

  app.post(
    "/v1/admin/staff",
    staff(MANAGERS, async (req, reply, ctx) => {
      const input = parse(StaffCreateInput, req.body);
      if (input.role === "OWNER" && ctx.role !== "OWNER") throw forbidden("Only the owner can add another owner");
      if (input.password && !input.email) throw badRequest("EMAIL_REQUIRED", "Email is needed for password login");
      await assertOwned("station", [input.stationId]);
      reply.status(201);
      return db.staff.create({
        data: {
          hotelId: ctx.hid,
          name: input.name,
          role: input.role,
          phone: input.phone ?? null,
          email: input.email?.toLowerCase() ?? null,
          passwordHash: input.password ? await hashSecret(input.password) : null,
          pinHash: await hashSecret(input.pin),
          stationId: input.stationId ?? null,
          language: input.language,
        },
        select: staffSelect,
      });
    }),
  );

  app.patch(
    "/v1/admin/staff/:id",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const input = parse(StaffUpdateInput, req.body);
      const target = await db.staff.findUnique({ where: { id } });
      if (!target) throw notFound("Staff");
      if ((target.role === "OWNER" || input.role === "OWNER") && ctx.role !== "OWNER") throw forbidden("Only the owner can change an owner");
      await assertOwned("station", [input.stationId]);
      const { password, email, ...rest } = input;
      const updated = await db.staff.update({
        where: { id },
        data: {
          ...rest,
          ...(email !== undefined && { email: email?.toLowerCase() ?? null }),
          ...(password && { passwordHash: await hashSecret(password) }),
        },
        select: staffSelect,
      });
      if (input.isActive === false || input.role !== undefined) await revokeAllFor("STAFF", id);
      return updated;
    }),
  );

  app.post(
    "/v1/admin/staff/:id/reset-pin",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const { pin } = parse(ResetPinInput, req.body);
      const target = await db.staff.findUnique({ where: { id } });
      if (!target) throw notFound("Staff");
      if (target.role === "OWNER" && ctx.role !== "OWNER") throw forbidden();
      await db.staff.update({ where: { id }, data: { pinHash: await hashSecret(pin), pinFailedCount: 0, lockedUntil: null } });
      await audit(ctx.sub, "STAFF_PIN_RESET", "Staff", id);
      return { ok: true };
    }),
  );

  // ── Table assignments (per shift date) ──────
  app.get(
    "/v1/admin/assignments",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
      const day = date ? new Date(`${date}T00:00:00Z`) : businessDay(await getHotel(ctx.hid)).date;
      return db.tableAssignment.findMany({ where: { shiftDate: day }, select: { tableId: true, staffId: true } });
    }),
  );
  app.put(
    "/v1/admin/assignments",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const input = parse(AssignmentsInput, req.body);
      await assertOwned("table", input.assignments.map((a) => a.tableId));
      await assertOwned("staff", input.assignments.map((a) => a.staffId));
      const shiftDate = input.date ? new Date(`${input.date}T00:00:00Z`) : businessDay(await getHotel(ctx.hid)).date;
      await db.$transaction(async (tx) => {
        await tx.tableAssignment.deleteMany({ where: { shiftDate } });
        await tx.tableAssignment.createMany({
          data: input.assignments.map((a) => ({ hotelId: ctx.hid, tableId: a.tableId, staffId: a.staffId, shiftDate })),
          skipDuplicates: true,
        });
      });
      return { ok: true, count: input.assignments.length };
    }),
  );

  // ── Devices ───────────────────────────────────
  app.get(
    "/v1/admin/devices",
    staff(MANAGERS, async () =>
      db.device.findMany({
        where: { revokedAt: null },
        select: { id: true, name: true, kind: true, stationId: true, lastSeenAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ),
  );
  // ── Audit log ────────────────────────────────
  app.get(
    "/v1/admin/audit",
    staff(MANAGERS, async (req): Promise<AuditPage> => {
      const q = parse(z.object({ action: AuditAction.optional(), before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
      const rows = await db.auditLog.findMany({
        where: { ...(q.action ? { action: q.action } : {}), ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
        orderBy: { createdAt: "desc" },
        take: q.limit + 1,
      });
      const page = rows.slice(0, q.limit);
      const actorIds = [...new Set(page.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
      const actors = new Map((await db.staff.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, role: true } })).map((a) => [a.id, a]));
      return {
        entries: page.map((r) => ({
          id: r.id,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          meta: r.meta,
          createdAt: r.createdAt.toISOString(),
          actor: r.actorId ? (actors.get(r.actorId) ?? null) : null,
        })),
        next: rows.length > q.limit ? (page.at(-1)?.createdAt.toISOString() ?? null) : null,
      };
    }),
  );

  /** Offline / hub actions the server refused, so a manager can see what didn't happen. */
  app.get(
    "/v1/admin/sync-rejections",
    staff(MANAGERS, async (): Promise<SyncRejectionView[]> => {
      const rows = await db.syncRejection.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
      const devices = new Map((await db.device.findMany({ where: { id: { in: rows.flatMap((r) => (r.deviceId ? [r.deviceId] : [])) } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      return rows.map((r) => ({
        id: r.id,
        clientId: r.clientId,
        reason: r.reason,
        command: r.command,
        device: r.deviceId ? (devices.get(r.deviceId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
      }));
    }),
  );

  app.delete(
    "/v1/admin/devices/:id",
    staff(MANAGERS, async (req) => {
      const { id } = parse(IdParam, req.params);
      await db.device.update({ where: { id }, data: { revokedAt: new Date() } });
      return { ok: true };
    }),
  );

  // ── Image upload: resized to WebP, stored on local disk (dev) or S3 / R2 ──
  app.post(
    "/v1/admin/uploads",
    staff(MANAGERS, async (req, reply, ctx) => {
      const file = await req.file({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
      if (!file) throw badRequest("NO_FILE", "Attach an image");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) throw badRequest("BAD_TYPE", "Use JPG, PNG or WebP");
      const buf = await file.toBuffer();
      if (file.file.truncated) throw conflict("TOO_LARGE", "Image must be under 8 MB");
      let image: Buffer;
      try {
        image = await toWebp(buf);
      } catch {
        throw badRequest("BAD_IMAGE", "That file isn't a readable image");
      }
      reply.status(201);
      return { url: await saveImage(ctx.hid, image) };
    }),
  );
}

async function qrSheet(hotelName: string, cards: { label: string; url: string }[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const cols = 2;
  const rowsPerPage = 3;
  const cellW = (doc.page.width - 72) / cols;
  const cellH = (doc.page.height - 72) / rowsPerPage;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card) continue;
    const slot = i % (cols * rowsPerPage);
    if (i > 0 && slot === 0) doc.addPage();
    const x = 36 + (slot % cols) * cellW;
    const y = 36 + Math.floor(slot / cols) * cellH;
    doc.roundedRect(x + 6, y + 6, cellW - 12, cellH - 12, 10).lineWidth(1).stroke("#cccccc");
    doc.fillColor("#111111").fontSize(14).text(hotelName, x, y + 20, { width: cellW, align: "center" });
    const png = await QRCode.toBuffer(card.url, { margin: 1, width: 360, errorCorrectionLevel: "M" });
    const size = Math.min(cellW, cellH) - 110;
    doc.image(png, x + (cellW - size) / 2, y + 44, { width: size, height: size });
    doc.fontSize(22).text(card.label, x, y + 52 + size, { width: cellW, align: "center" });
    doc.fontSize(10).fillColor("#555555").text("Scan to see the menu and order", x, y + 80 + size, { width: cellW, align: "center" });
  }
  if (cards.length === 0) doc.fontSize(14).text("No tables yet.");
  doc.end();
  return done;
}
