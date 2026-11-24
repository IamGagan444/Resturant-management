-- Walk-in parcels: a "parcel counter" QR where every customer gets their own session and token number.
ALTER TABLE "Table" ADD COLUMN "isParcelCounter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TableSession" ADD COLUMN "parcelNo" INTEGER;

-- One live session per table still holds, except for parcel sessions.
DROP INDEX "TableSession_one_live_per_table";
CREATE UNIQUE INDEX "TableSession_one_live_per_table"
  ON "TableSession" ("tableId")
  WHERE "status" IN ('OPEN', 'BILLING') AND "parcelNo" IS NULL;
