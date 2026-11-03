-- One sign-in = one refresh-token family (stable across rotations); access tokens carry it as `rid`.
ALTER TABLE "RefreshToken" ADD COLUMN "familyId" TEXT;
UPDATE "RefreshToken" SET "familyId" = "id" WHERE "familyId" IS NULL;
ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- Authenticator being set up / moved to a new phone (becomes mfaSecretEnc once a code from it is entered).
ALTER TABLE "PlatformUser" ADD COLUMN "mfaPendingSecretEnc" TEXT;
ALTER TABLE "Staff" ADD COLUMN "mfaPendingSecretEnc" TEXT;
