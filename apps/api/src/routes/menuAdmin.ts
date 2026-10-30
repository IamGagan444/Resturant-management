import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, type Prisma } from "@rms/db";
import { AddonGroupInput, CategoryInput, Id, MenuItemInput } from "@rms/contracts";
import { audit } from "../lib/audit";
import { notFound, parse } from "../lib/errors";
import { assertOwned } from "../lib/owned";
import { MANAGERS, staff } from "../lib/route";
import { emit } from "../realtime/io";
import { rooms } from "@rms/contracts";
import { invalidateMenu } from "../services/menu";

const IdParam = z.object({ id: Id });

const itemInclude = {
  variants: { orderBy: { sortOrder: "asc" } },
  taxes: { select: { id: true } },
  addonGroups: { select: { id: true } },
} satisfies Prisma.MenuItemInclude;

type ItemRow = Prisma.MenuItemGetPayload<{ include: typeof itemInclude }>;
const toItem = ({ taxes, addonGroups, ...i }: ItemRow) => ({
  ...i,
  taxIds: taxes.map((t) => t.id),
  addonGroupIds: addonGroups.map((g) => g.id),
});

export async function menuAdminRoutes(app: FastifyInstance) {
  // Any menu / settings write changes what guests see: drop cached menus before the response goes out.
  app.addHook("onSend", async (req, _reply, payload) => {
    if (req.method !== "GET") invalidateMenu();
    return payload;
  });
  // ── Categories ────────────────────────────────
  app.get(
    "/v1/admin/categories",
    staff(MANAGERS, async () => db.menuCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })),
  );
  app.post(
    "/v1/admin/categories",
    staff(MANAGERS, async (req, reply, ctx) => {
      const input = parse(CategoryInput, req.body);
      reply.status(201);
      return db.menuCategory.create({ data: { hotelId: ctx.hid, ...input, translations: input.translations ?? undefined } });
    }),
  );
  app.patch(
    "/v1/admin/categories/:id",
    staff(MANAGERS, async (req) => {
      const input = parse(CategoryInput.partial(), req.body);
      return db.menuCategory.update({ where: { id: parse(IdParam, req.params).id }, data: { ...input, translations: input.translations ?? undefined } });
    }),
  );
  app.put(
    "/v1/admin/categories/order",
    staff(MANAGERS, async (req) => {
      const { ids } = parse(z.object({ ids: z.array(Id).max(200) }), req.body);
      await db.$transaction(ids.map((id, i) => db.menuCategory.update({ where: { id }, data: { sortOrder: i } })));
      return { ok: true };
    }),
  );
  app.delete(
    "/v1/admin/categories/:id",
    staff(MANAGERS, async (req) => {
      await db.menuCategory.delete({ where: { id: parse(IdParam, req.params).id } });
      return { ok: true };
    }),
  );

  // ── Items ─────────────────────────────────────
  app.get(
    "/v1/admin/items",
    staff(MANAGERS, async () => {
      const rows = await db.menuItem.findMany({ where: { isActive: true }, include: itemInclude, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      return rows.map(toItem);
    }),
  );
  app.get(
    "/v1/admin/items/:id",
    staff(MANAGERS, async (req) => {
      const row = await db.menuItem.findUnique({ where: { id: parse(IdParam, req.params).id }, include: itemInclude });
      if (!row) throw notFound("Item");
      return toItem(row);
    }),
  );

  app.post(
    "/v1/admin/items",
    staff(MANAGERS, async (req, reply, ctx) => {
      const input = parse(MenuItemInput, req.body);
      await Promise.all([
        assertOwned("category", [input.categoryId]),
        assertOwned("station", [input.stationId]),
        assertOwned("tax", input.taxIds),
        assertOwned("addonGroup", input.addonGroupIds),
      ]);
      const { taxIds, addonGroupIds, variants, translations, ...fields } = input;
      const row = await db.menuItem.create({
        data: {
          hotelId: ctx.hid,
          ...fields,
          translations: translations ?? undefined,
          taxes: { connect: taxIds.map((id) => ({ id })) },
          addonGroups: { connect: addonGroupIds.map((id) => ({ id })) },
          variants: { create: variants.map((v, i) => ({ hotelId: ctx.hid, name: v.name, price: v.price, sortOrder: i })) },
        },
        include: itemInclude,
      });
      reply.status(201);
      return toItem(row);
    }),
  );

  /** Partial update; `variants` (if sent) replaces the list, keeping ids that are passed back. */
  app.patch(
    "/v1/admin/items/:id",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const input = parse(MenuItemInput.partial(), req.body);
      const before = await db.menuItem.findUnique({ where: { id } });
      if (!before) throw notFound("Item");
      await Promise.all([
        assertOwned("category", [input.categoryId]),
        assertOwned("station", [input.stationId]),
        assertOwned("tax", input.taxIds ?? []),
        assertOwned("addonGroup", input.addonGroupIds ?? []),
      ]);
      const { taxIds, addonGroupIds, variants, translations, ...fields } = input;
      const row = await db.$transaction(async (tx) => {
        if (variants) {
          const keep = variants.flatMap((v) => (v.id ? [v.id] : []));
          await tx.itemVariant.deleteMany({ where: { itemId: id, id: { notIn: keep } } });
          for (const [i, v] of variants.entries()) {
            if (v.id) await tx.itemVariant.update({ where: { id: v.id, itemId: id }, data: { name: v.name, price: v.price, sortOrder: i } });
            else await tx.itemVariant.create({ data: { hotelId: ctx.hid, itemId: id, name: v.name, price: v.price, sortOrder: i } });
          }
        }
        return tx.menuItem.update({
          where: { id },
          data: {
            ...fields,
            ...(translations !== undefined && { translations }),
            ...(taxIds && { taxes: { set: taxIds.map((t) => ({ id: t })) } }),
            ...(addonGroupIds && { addonGroups: { set: addonGroupIds.map((g) => ({ id: g })) } }),
          },
          include: itemInclude,
        });
      });
      if (input.price !== undefined && input.price !== before.price) {
        await audit(ctx.sub, "PRICE_CHANGED", "MenuItem", id, { from: before.price, to: input.price });
      }
      if (input.isAvailable !== undefined && input.isAvailable !== before.isAvailable) {
        emit("menu:item_availability", [rooms.menu(ctx.hid), rooms.kitchen(ctx.hid), rooms.managers(ctx.hid)], {
          hotelId: ctx.hid,
          menuItemId: id,
          isAvailable: input.isAvailable,
        });
      }
      return toItem(row);
    }),
  );

  /** Soft delete: past orders still reference the item. */
  app.delete(
    "/v1/admin/items/:id",
    staff(MANAGERS, async (req) => {
      await db.menuItem.update({ where: { id: parse(IdParam, req.params).id }, data: { isActive: false } });
      return { ok: true };
    }),
  );

  // ── Add-on groups ─────────────────────────────
  app.get(
    "/v1/admin/addon-groups",
    staff(MANAGERS, async () => db.addonGroup.findMany({ include: { addons: { orderBy: { id: "asc" } } }, orderBy: { name: "asc" } })),
  );
  app.post(
    "/v1/admin/addon-groups",
    staff(MANAGERS, async (req, reply, ctx) => {
      const { addons, ...g } = parse(AddonGroupInput, req.body);
      reply.status(201);
      return db.addonGroup.create({
        data: { hotelId: ctx.hid, ...g, addons: { create: addons.map(({ id: _id, ...a }) => ({ hotelId: ctx.hid, ...a })) } },
        include: { addons: true },
      });
    }),
  );
  app.put(
    "/v1/admin/addon-groups/:id",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const { addons, ...g } = parse(AddonGroupInput, req.body);
      return db.$transaction(async (tx) => {
        await tx.addonGroup.update({ where: { id }, data: g });
        const keep = addons.flatMap((a) => (a.id ? [a.id] : []));
        // Addons referenced by past orders can't be deleted; mark them unavailable instead.
        const stale = await tx.addon.findMany({ where: { groupId: id, id: { notIn: keep } }, select: { id: true } });
        for (const s of stale) {
          const used = await tx.orderItemAddon.count({ where: { addonId: s.id } });
          if (used) await tx.addon.update({ where: { id: s.id }, data: { isAvailable: false } });
          else await tx.addon.delete({ where: { id: s.id } });
        }
        for (const a of addons) {
          if (a.id) await tx.addon.update({ where: { id: a.id, groupId: id }, data: { name: a.name, price: a.price, isAvailable: a.isAvailable } });
          else await tx.addon.create({ data: { hotelId: ctx.hid, groupId: id, name: a.name, price: a.price, isAvailable: a.isAvailable } });
        }
        return tx.addonGroup.findUniqueOrThrow({ where: { id }, include: { addons: true } });
      });
    }),
  );
  app.delete(
    "/v1/admin/addon-groups/:id",
    staff(MANAGERS, async (req) => {
      await db.addonGroup.delete({ where: { id: parse(IdParam, req.params).id } });
      return { ok: true };
    }),
  );
}
