-- Who/where a login came from, for the super admin's session list
ALTER TABLE "RefreshToken" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "ip" TEXT;
