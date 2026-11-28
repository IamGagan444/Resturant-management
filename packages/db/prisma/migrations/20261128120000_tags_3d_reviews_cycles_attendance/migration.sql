-- Smart dish tags (replace the single Bestseller flag), 3D/AR models, Google review link,
-- quarterly / yearly plan prices, and staff attendance (presence spans + manager marks).

CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');
CREATE TYPE "AttendanceMarkKind" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'WEEK_OFF');

ALTER TABLE "Plan" ADD COLUMN "priceQuarterly" INTEGER, ADD COLUMN "priceYearly" INTEGER;

ALTER TABLE "Hotel" ADD COLUMN "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY', ADD COLUMN "googleReviewUrl" TEXT;

-- keep every existing Bestseller: copy the flag into tags before dropping it
ALTER TABLE "MenuItem" ADD COLUMN "modelUrl" TEXT, ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "MenuItem" SET "tags" = ARRAY['BESTSELLER']::TEXT[] WHERE "isBestseller" = true;
ALTER TABLE "MenuItem" DROP COLUMN "isBestseller";

CREATE TABLE "StaffPresence" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "deviceId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "StaffPresence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StaffPresence_order_check" CHECK ("lastSeenAt" >= "startedAt")
);
CREATE INDEX "StaffPresence_staffId_lastSeenAt_idx" ON "StaffPresence"("staffId", "lastSeenAt");
CREATE INDEX "StaffPresence_hotelId_lastSeenAt_idx" ON "StaffPresence"("hotelId", "lastSeenAt");
ALTER TABLE "StaffPresence" ADD CONSTRAINT "StaffPresence_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffPresence" ADD CONSTRAINT "StaffPresence_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AttendanceMark" (
    "hotelId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" "AttendanceMarkKind" NOT NULL,
    "note" TEXT,
    "markedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceMark_pkey" PRIMARY KEY ("staffId","day")
);
CREATE INDEX "AttendanceMark_hotelId_day_idx" ON "AttendanceMark"("hotelId", "day");
ALTER TABLE "AttendanceMark" ADD CONSTRAINT "AttendanceMark_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceMark" ADD CONSTRAINT "AttendanceMark_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, same as every tenant table
GRANT SELECT, INSERT, UPDATE, DELETE ON "StaffPresence", "AttendanceMark" TO rms_app, rms_platform;
ALTER TABLE "StaffPresence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffPresence" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "StaffPresence" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);
ALTER TABLE "AttendanceMark" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AttendanceMark" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "AttendanceMark" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);
