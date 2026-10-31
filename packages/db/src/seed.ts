/**
 * Demo data. Idempotent: deletes the demo hotel (cascade) and recreates it.
 *
 *   Super admin   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (from .env)
 *   Owner         owner@spicegarden.test / owner12345
 *   Staff PINs    Manager 1000 · Cashier 2000 · Cook Tandoor 3001 · Cook Kitchen 3002 · Cook Bar 3003
 *                 Waiter Ravi 4001 (T1–T4, R1–R2) · Waiter Priya 4002 (T5–T8, R3–R4)
 *   Customer URL  {CUSTOMER_URL}/h/spice-garden/t/{qrToken}  (printed at the end)
 */
import { config } from "dotenv";
import { hash } from "@node-rs/argon2";
import { ensurePlatform } from "./bootstrap";
import { PrismaClient, type FoodType, type Table } from "@prisma/client";
import { businessDate } from "@rms/domain";

config({ path: "../../.env" });

const prisma = new PrismaClient();
const SLUG = "spice-garden";

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword === "change-me") throw new Error("Set SEED_ADMIN_PASSWORD in .env");

  const { starter } = await ensurePlatform(prisma, { email: adminEmail, password: adminPassword });

  await prisma.hotel.deleteMany({ where: { slug: SLUG } });
  const hotel = await prisma.hotel.create({
    data: {
      name: "Spice Garden",
      slug: SLUG,
      phone: "+919876543210",
      address: "12 MG Road, Bhubaneswar, Odisha",
      gstin: "21AAAAA0000A1Z5",
      status: "ACTIVE",
      planId: starter.id,
      serviceChargeBps: 0,
    },
  });
  const hotelId = hotel.id;

  const [cgst, sgst] = await Promise.all([
    prisma.tax.create({ data: { hotelId, name: "CGST", rateBps: 250 } }),
    prisma.tax.create({ data: { hotelId, name: "SGST", rateBps: 250 } }),
  ]);
  const gst = [{ id: cgst.id }, { id: sgst.id }];

  const station = async (name: string, color: string) => prisma.station.create({ data: { hotelId, name, color } });
  const tandoor = await station("Tandoor", "#f97316");
  const kitchen = await station("Kitchen", "#22c55e");
  const bar = await station("Bar", "#3b82f6");

  const pin = (p: string) => hash(p);
  const ownerHash = await hash("owner12345");
  await prisma.staff.create({
    data: { hotelId, name: "Anita (Owner)", email: "owner@spicegarden.test", passwordHash: ownerHash, role: "OWNER", phone: "9000000001", pinHash: await pin("9999") },
  });
  await prisma.staff.create({ data: { hotelId, name: "Manoj", role: "MANAGER", phone: "9000000002", pinHash: await pin("1000") } });
  await prisma.staff.create({ data: { hotelId, name: "Kavya", role: "CASHIER", phone: "9000000003", pinHash: await pin("2000") } });
  await prisma.staff.create({ data: { hotelId, name: "Raju", role: "COOK", phone: "9000000004", pinHash: await pin("3001"), stationId: tandoor.id } });
  await prisma.staff.create({ data: { hotelId, name: "Suresh", role: "COOK", phone: "9000000005", pinHash: await pin("3002"), stationId: kitchen.id } });
  await prisma.staff.create({ data: { hotelId, name: "Deepak", role: "COOK", phone: "9000000006", pinHash: await pin("3003"), stationId: bar.id } });
  const ravi = await prisma.staff.create({ data: { hotelId, name: "Ravi", role: "WAITER", phone: "9000000007", pinHash: await pin("4001") } });
  const priya = await prisma.staff.create({ data: { hotelId, name: "Priya", role: "WAITER", phone: "9000000008", pinHash: await pin("4002") } });

  const ground = await prisma.floor.create({ data: { hotelId, name: "Ground Floor", sortOrder: 0 } });
  const roof = await prisma.floor.create({ data: { hotelId, name: "Rooftop", sortOrder: 1 } });
  const tables: Table[] = [];
  for (let i = 1; i <= 8; i++) {
    tables.push(
      await prisma.table.create({
        data: { hotelId, floorId: ground.id, label: `T${i}`, seats: i <= 4 ? 4 : 6, posX: 14 + ((i - 1) % 4) * 24, posY: 18 + Math.floor((i - 1) / 4) * 28 },
      }),
    );
  }
  for (let i = 1; i <= 4; i++) {
    tables.push(
      await prisma.table.create({ data: { hotelId, floorId: roof.id, label: `R${i}`, seats: 2, posX: 14 + (i - 1) * 24, posY: 18 } }),
    );
  }

  const shiftDate = new Date(`${businessDate(new Date(), hotel.timezone, hotel.dayStartsAt)}T00:00:00Z`);
  const assign = (labels: string[], staffId: string) =>
    prisma.tableAssignment.createMany({
      data: tables.filter((t) => labels.includes(t.label)).map((t) => ({ hotelId, tableId: t.id, staffId, shiftDate })),
    });
  await assign(["T1", "T2", "T3", "T4", "R1", "R2"], ravi.id);
  await assign(["T5", "T6", "T7", "T8", "R3", "R4"], priya.id);

  // ── Menu ──────────────────────────────────────
  const breadChoice = await prisma.addonGroup.create({
    data: {
      hotelId,
      name: "Choose bread",
      minSelect: 1,
      maxSelect: 1,
      addons: {
        create: [
          { hotelId, name: "Butter Naan", price: 0 },
          { hotelId, name: "Garlic Naan", price: 2000 },
          { hotelId, name: "Laccha Paratha", price: 1500 },
        ],
      },
    },
  });
  const extras = await prisma.addonGroup.create({
    data: {
      hotelId,
      name: "Extras",
      minSelect: 0,
      maxSelect: 3,
      addons: {
        create: [
          { hotelId, name: "Extra cheese", price: 3000 },
          { hotelId, name: "Extra butter", price: 1500 },
          { hotelId, name: "Onion salad", price: 1000 },
        ],
      },
    },
  });

  const category = (name: string, sortOrder: number, hi: string, window?: [string, string]) =>
    prisma.menuCategory.create({
      data: { hotelId, name, sortOrder, translations: { hi: { name: hi } }, availableFrom: window?.[0], availableTo: window?.[1] },
    });
  const breakfast = await category("Breakfast", 0, "नाश्ता", ["07:00", "11:00"]);
  const starters = await category("Starters", 1, "स्टार्टर");
  const mains = await category("Main Course", 2, "मुख्य व्यंजन");
  const breads = await category("Breads", 3, "रोटियाँ");
  const drinks = await category("Beverages", 4, "पेय");

  type ItemSeed = {
    categoryId: string;
    stationId: string;
    name: string;
    hi: string;
    price: number;
    foodType?: FoodType;
    spiceLevel?: number;
    prepTimeMin?: number;
    isBestseller?: boolean;
    description?: string;
    variants?: [string, number][];
    addonGroupIds?: string[];
  };
  const items: ItemSeed[] = [
    { categoryId: breakfast.id, stationId: kitchen.id, name: "Masala Dosa", hi: "मसाला डोसा", price: 12000, prepTimeMin: 12, isBestseller: true },
    { categoryId: breakfast.id, stationId: kitchen.id, name: "Idli Sambar", hi: "इडली सांभर", price: 8000, prepTimeMin: 8 },
    { categoryId: breakfast.id, stationId: kitchen.id, name: "Masala Omelette", hi: "मसाला ऑमलेट", price: 9000, foodType: "EGG", prepTimeMin: 8 },
    { categoryId: starters.id, stationId: tandoor.id, name: "Paneer Tikka", hi: "पनीर टिक्का", price: 26000, spiceLevel: 2, prepTimeMin: 18, isBestseller: true, variants: [["Half", 18000], ["Full", 26000]], addonGroupIds: [extras.id], description: "Cottage cheese marinated in yogurt and spices, char-grilled in the tandoor." },
    { categoryId: starters.id, stationId: tandoor.id, name: "Chicken Tikka", hi: "चिकन टिक्का", price: 32000, foodType: "NON_VEG", spiceLevel: 2, prepTimeMin: 20, variants: [["Half", 20000], ["Full", 32000]] },
    { categoryId: starters.id, stationId: kitchen.id, name: "Veg Manchurian", hi: "वेज मंचूरियन", price: 18000, spiceLevel: 1, prepTimeMin: 12 },
    { categoryId: starters.id, stationId: kitchen.id, name: "Chilli Chicken", hi: "चिली चिकन", price: 24000, foodType: "NON_VEG", spiceLevel: 3, prepTimeMin: 15 },
    { categoryId: mains.id, stationId: kitchen.id, name: "Paneer Butter Masala", hi: "पनीर बटर मसाला", price: 28000, spiceLevel: 1, prepTimeMin: 15, isBestseller: true, addonGroupIds: [breadChoice.id, extras.id] },
    { categoryId: mains.id, stationId: kitchen.id, name: "Dal Makhani", hi: "दाल मखनी", price: 22000, prepTimeMin: 10, addonGroupIds: [breadChoice.id] },
    { categoryId: mains.id, stationId: kitchen.id, name: "Butter Chicken", hi: "बटर चिकन", price: 34000, foodType: "NON_VEG", spiceLevel: 1, prepTimeMin: 18, isBestseller: true, addonGroupIds: [breadChoice.id, extras.id] },
    { categoryId: mains.id, stationId: kitchen.id, name: "Veg Biryani", hi: "वेज बिरयानी", price: 24000, spiceLevel: 2, prepTimeMin: 20, variants: [["Regular", 24000], ["Family", 42000]] },
    { categoryId: mains.id, stationId: kitchen.id, name: "Egg Curry", hi: "अंडा करी", price: 20000, foodType: "EGG", spiceLevel: 2, prepTimeMin: 12 },
    { categoryId: breads.id, stationId: tandoor.id, name: "Butter Naan", hi: "बटर नान", price: 6000, prepTimeMin: 6, isBestseller: true },
    { categoryId: breads.id, stationId: tandoor.id, name: "Garlic Naan", hi: "गार्लिक नान", price: 7500, prepTimeMin: 6 },
    { categoryId: breads.id, stationId: tandoor.id, name: "Tandoori Roti", hi: "तंदूरी रोटी", price: 3000, foodType: "VEGAN", prepTimeMin: 5 },
    { categoryId: drinks.id, stationId: bar.id, name: "Masala Chaas", hi: "मसाला छाछ", price: 6000, prepTimeMin: 3 },
    { categoryId: drinks.id, stationId: bar.id, name: "Fresh Lime Soda", hi: "फ्रेश लाइम सोडा", price: 8000, foodType: "VEGAN", prepTimeMin: 3, variants: [["Sweet", 8000], ["Salted", 8000], ["Mixed", 8000]] },
    { categoryId: drinks.id, stationId: bar.id, name: "Mango Lassi", hi: "मैंगो लस्सी", price: 11000, prepTimeMin: 4, isBestseller: true },
  ];

  let sort = 0;
  for (const it of items) {
    await prisma.menuItem.create({
      data: {
        hotelId,
        categoryId: it.categoryId,
        stationId: it.stationId,
        name: it.name,
        translations: { hi: { name: it.hi } },
        description: it.description,
        price: it.price,
        foodType: it.foodType ?? "VEG",
        spiceLevel: it.spiceLevel,
        prepTimeMin: it.prepTimeMin ?? 15,
        isBestseller: it.isBestseller ?? false,
        sortOrder: sort++,
        taxes: { connect: gst },
        addonGroups: { connect: (it.addonGroupIds ?? []).map((id) => ({ id })) },
        variants: { create: (it.variants ?? []).map(([name, price], i) => ({ hotelId, name, price, sortOrder: i })) },
      },
    });
  }

  const base = process.env.CUSTOMER_URL ?? "http://localhost:3000";
  console.log(`\nSeeded "${hotel.name}" (${hotelId})`);
  console.log(`  Super admin: ${adminEmail}`);
  console.log(`  Owner:       owner@spicegarden.test / owner12345`);
  console.log(`  Customer QR: ${base}/h/${SLUG}/t/${tables[0]?.qrToken}  (T1)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
