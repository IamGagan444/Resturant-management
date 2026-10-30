-- Partial unique indexes Prisma can't express. Appended to the migration that creates these tables.

-- One live session per table.
CREATE UNIQUE INDEX IF NOT EXISTS "TableSession_one_live_per_table"
  ON "TableSession" ("tableId")
  WHERE "status" IN ('OPEN', 'BILLING');

-- One open request per type per session (stops "call waiter" spam).
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceRequest_one_open_per_type"
  ON "ServiceRequest" ("sessionId", "type")
  WHERE "status" = 'OPEN';

-- One non-void bill per session (a voided bill can be reissued).
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_one_live_per_session"
  ON "Bill" ("sessionId")
  WHERE "status" <> 'VOID';
