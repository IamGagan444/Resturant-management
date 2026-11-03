-- Row-level security: tenant isolation enforced by PostgreSQL itself, under the application's own checks.
--
-- Roles (none of them owns the tables, so none of them skips RLS; migrations run as the owner):
--   rms_app       the API's tenant client. Sees only rows whose "hotelId" equals the transaction-local
--                 setting rms.hotel_id, which the Prisma client sets on every query (packages/db/src/index.ts).
--                 No setting → no rows. It has no grant at all on platform tables (admins, refresh tokens,
--                 webhooks, plans) and no policy that could widen its view: a bug or injection in tenant code
--                 can't reach another restaurant.
--   rms_platform  the API's unscoped client (sign-in, platform admin, background jobs). All rows.
-- Passwords and LOGIN are set per environment by `pnpm db:provision` (never in a migration).
--
-- New tenant table? Grant it to rms_app, ENABLE ROW LEVEL SECURITY and add both policies, like below.
-- test/rls.test.ts fails if a table with "hotelId" is left unprotected.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rms_app') THEN
    CREATE ROLE rms_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rms_platform') THEN
    CREATE ROLE rms_platform NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;

-- Least privilege: data only (no DDL, no TRUNCATE), and nothing on Prisma's migration table.
GRANT USAGE ON SCHEMA public TO rms_app, rms_platform;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM rms_app, rms_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rms_platform;
REVOKE ALL ON "_prisma_migrations" FROM rms_app, rms_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rms_app, rms_platform;
-- tables created by later migrations: the platform client gets them automatically; rms_app only by explicit grant
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rms_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rms_app, rms_platform;

-- Staff
GRANT SELECT, INSERT, UPDATE, DELETE ON "Staff" TO rms_app;
ALTER TABLE "Staff" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Staff" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Staff" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Device
GRANT SELECT, INSERT, UPDATE, DELETE ON "Device" TO rms_app;
ALTER TABLE "Device" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Device" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Device" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Floor
GRANT SELECT, INSERT, UPDATE, DELETE ON "Floor" TO rms_app;
ALTER TABLE "Floor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Floor" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Floor" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Table
GRANT SELECT, INSERT, UPDATE, DELETE ON "Table" TO rms_app;
ALTER TABLE "Table" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Table" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Table" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- TableAssignment
GRANT SELECT, INSERT, UPDATE, DELETE ON "TableAssignment" TO rms_app;
ALTER TABLE "TableAssignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TableAssignment" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "TableAssignment" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Station
GRANT SELECT, INSERT, UPDATE, DELETE ON "Station" TO rms_app;
ALTER TABLE "Station" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Station" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Station" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Tax
GRANT SELECT, INSERT, UPDATE, DELETE ON "Tax" TO rms_app;
ALTER TABLE "Tax" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tax" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Tax" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- MenuCategory
GRANT SELECT, INSERT, UPDATE, DELETE ON "MenuCategory" TO rms_app;
ALTER TABLE "MenuCategory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MenuCategory" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "MenuCategory" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- MenuItem
GRANT SELECT, INSERT, UPDATE, DELETE ON "MenuItem" TO rms_app;
ALTER TABLE "MenuItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MenuItem" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "MenuItem" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- ItemVariant
GRANT SELECT, INSERT, UPDATE, DELETE ON "ItemVariant" TO rms_app;
ALTER TABLE "ItemVariant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ItemVariant" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "ItemVariant" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- AddonGroup
GRANT SELECT, INSERT, UPDATE, DELETE ON "AddonGroup" TO rms_app;
ALTER TABLE "AddonGroup" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AddonGroup" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "AddonGroup" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Addon
GRANT SELECT, INSERT, UPDATE, DELETE ON "Addon" TO rms_app;
ALTER TABLE "Addon" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Addon" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Addon" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Customer
GRANT SELECT, INSERT, UPDATE, DELETE ON "Customer" TO rms_app;
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Customer" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Customer" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- TableSession
GRANT SELECT, INSERT, UPDATE, DELETE ON "TableSession" TO rms_app;
ALTER TABLE "TableSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TableSession" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "TableSession" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- SessionGuest
GRANT SELECT, INSERT, UPDATE, DELETE ON "SessionGuest" TO rms_app;
ALTER TABLE "SessionGuest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SessionGuest" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "SessionGuest" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- CartItem
GRANT SELECT, INSERT, UPDATE, DELETE ON "CartItem" TO rms_app;
ALTER TABLE "CartItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CartItem" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "CartItem" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Order
GRANT SELECT, INSERT, UPDATE, DELETE ON "Order" TO rms_app;
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Order" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Order" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- OrderItem
GRANT SELECT, INSERT, UPDATE, DELETE ON "OrderItem" TO rms_app;
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrderItem" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "OrderItem" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- OrderItemAddon
GRANT SELECT, INSERT, UPDATE, DELETE ON "OrderItemAddon" TO rms_app;
ALTER TABLE "OrderItemAddon" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrderItemAddon" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "OrderItemAddon" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- ServiceRequest
GRANT SELECT, INSERT, UPDATE, DELETE ON "ServiceRequest" TO rms_app;
ALTER TABLE "ServiceRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServiceRequest" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "ServiceRequest" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Bill
GRANT SELECT, INSERT, UPDATE, DELETE ON "Bill" TO rms_app;
ALTER TABLE "Bill" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Bill" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Bill" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- BillTaxLine
GRANT SELECT, INSERT, UPDATE, DELETE ON "BillTaxLine" TO rms_app;
ALTER TABLE "BillTaxLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillTaxLine" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "BillTaxLine" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- BillSplit
GRANT SELECT, INSERT, UPDATE, DELETE ON "BillSplit" TO rms_app;
ALTER TABLE "BillSplit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillSplit" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "BillSplit" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Payment
GRANT SELECT, INSERT, UPDATE, DELETE ON "Payment" TO rms_app;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Payment" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Payment" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Counter
GRANT SELECT, INSERT, UPDATE, DELETE ON "Counter" TO rms_app;
ALTER TABLE "Counter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Counter" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Counter" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- IdempotencyKey
GRANT SELECT, INSERT, UPDATE, DELETE ON "IdempotencyKey" TO rms_app;
ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IdempotencyKey" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "IdempotencyKey" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- SyncRejection
GRANT SELECT, INSERT, UPDATE, DELETE ON "SyncRejection" TO rms_app;
ALTER TABLE "SyncRejection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SyncRejection" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "SyncRejection" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- AuditLog
GRANT SELECT, INSERT, UPDATE, DELETE ON "AuditLog" TO rms_app;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog" AS PERMISSIVE FOR ALL TO rms_app
  USING ("hotelId" = current_setting('rms.hotel_id', true))
  WITH CHECK ("hotelId" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "AuditLog" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- _MenuItemToTax (implicit many-to-many, no hotelId): visible only through a MenuItem of the current hotel
GRANT SELECT, INSERT, UPDATE, DELETE ON "_MenuItemToTax" TO rms_app;
ALTER TABLE "_MenuItemToTax" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "_MenuItemToTax" AS PERMISSIVE FOR ALL TO rms_app
  USING (EXISTS (SELECT 1 FROM "MenuItem" m WHERE m."id" = "_MenuItemToTax"."A"))
  WITH CHECK (EXISTS (SELECT 1 FROM "MenuItem" m WHERE m."id" = "_MenuItemToTax"."A"));
CREATE POLICY platform_access ON "_MenuItemToTax" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- _AddonGroupToMenuItem (implicit many-to-many, no hotelId): visible only through a MenuItem of the current hotel
GRANT SELECT, INSERT, UPDATE, DELETE ON "_AddonGroupToMenuItem" TO rms_app;
ALTER TABLE "_AddonGroupToMenuItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "_AddonGroupToMenuItem" AS PERMISSIVE FOR ALL TO rms_app
  USING (EXISTS (SELECT 1 FROM "MenuItem" m WHERE m."id" = "_AddonGroupToMenuItem"."B"))
  WITH CHECK (EXISTS (SELECT 1 FROM "MenuItem" m WHERE m."id" = "_AddonGroupToMenuItem"."B"));
CREATE POLICY platform_access ON "_AddonGroupToMenuItem" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Hotel: the tenant client reads / updates only its own restaurant (settings, hub URL); never creates or deletes one.
GRANT SELECT, UPDATE ON "Hotel" TO rms_app;
ALTER TABLE "Hotel" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Hotel" AS PERMISSIVE FOR ALL TO rms_app
  USING ("id" = current_setting('rms.hotel_id', true))
  WITH CHECK ("id" = current_setting('rms.hotel_id', true));
CREATE POLICY platform_access ON "Hotel" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- PlatformUser: platform client only (rms_app has no grant)
ALTER TABLE "PlatformUser" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_access ON "PlatformUser" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- Plan: platform client only (rms_app has no grant)
ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_access ON "Plan" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- RefreshToken: platform client only (rms_app has no grant)
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_access ON "RefreshToken" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);

-- WebhookEvent: platform client only (rms_app has no grant)
ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_access ON "WebhookEvent" AS PERMISSIVE FOR ALL TO rms_platform USING (true) WITH CHECK (true);
