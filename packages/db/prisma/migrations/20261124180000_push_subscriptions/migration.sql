-- Web Push: which browsers ring which staff member.
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "deviceId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_hotelId_idx" ON "PushSubscription"("hotelId");
CREATE INDEX "PushSubscription_staffId_idx" ON "PushSubscription"("staffId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "PushSubscription" TO rms_app, rms_platform;
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PushSubscription" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "PushSubscription" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);
