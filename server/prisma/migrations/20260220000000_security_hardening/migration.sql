ALTER TABLE "User" ADD COLUMN "lockedUntil" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastFailedLoginAt" DATETIME;

ALTER TABLE "AuditLog" ADD COLUMN "requestId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "ip" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'info';
ALTER TABLE "AuditLog" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'app';

CREATE INDEX "AuditLog_severity_idx" ON "AuditLog"("severity");
CREATE INDEX "AuditLog_category_idx" ON "AuditLog"("category");
