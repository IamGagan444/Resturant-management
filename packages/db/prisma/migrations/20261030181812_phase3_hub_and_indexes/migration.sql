-- AlterEnum
ALTER TYPE "DeviceKind" ADD VALUE 'HUB';

-- DropIndex
DROP INDEX "Payment_sessionId_idx";

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "hubUrl" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_hotelId_action_createdAt_idx" ON "AuditLog"("hotelId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "Bill_hotelId_status_closedAt_idx" ON "Bill"("hotelId", "status", "closedAt");

-- CreateIndex
CREATE INDEX "Payment_sessionId_status_idx" ON "Payment"("sessionId", "status");
