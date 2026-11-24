-- Short code printed under each table's QR, typed by guests whose camera won't scan. Random, so one table's code
-- says nothing about another's. 32 characters without look-alikes (no 0/O, 1/I); keep in step with
-- packages/domain/src/tableCode.ts. Only random bytes 0-5 of the UUID are used (the version and variant bits come later).
CREATE FUNCTION new_table_code() RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', get_byte(u.b, i) % 32 + 1, 1), '')
  FROM (SELECT uuid_send(gen_random_uuid()) AS b) u, generate_series(0, 5) AS i
$$;

-- volatile default: every existing table gets its own code
ALTER TABLE "Table" ADD COLUMN "code" TEXT NOT NULL DEFAULT new_table_code();
CREATE UNIQUE INDEX "Table_code_key" ON "Table"("code");

-- Dishes to pack for taking away.
ALTER TABLE "CartItem" ADD COLUMN "isParcel" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderItem" ADD COLUMN "isParcel" BOOLEAN NOT NULL DEFAULT false;
