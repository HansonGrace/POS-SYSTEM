import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createLogicalBackup,
  restoreLogicalBackup,
  validateBackupDocument
} from "../../src/backup/backupService.js";

const dbFileName = `test-backup-${process.pid}-${Date.now()}.db`;
const dbRelativePath = `file:./${dbFileName}`;
const dbAbsolutePath = path.resolve(process.cwd(), "prisma", dbFileName);
const backupDir = path.resolve(process.cwd(), "tmp-backups");

process.env.NODE_ENV = "lab";
process.env.LAB_MODE = "true";
process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = dbRelativePath;
process.env.SESSION_SECRET = "test-backup-secret";
process.env.CSRF_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.LOCKOUT_ENABLED = "false";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.LOG_LEVEL = "silent";
process.env.APP_ENV_LABEL = "backup-test";

function cleanupDbFiles() {
  const files = [dbAbsolutePath, `${dbAbsolutePath}-journal`, `${dbAbsolutePath}-shm`, `${dbAbsolutePath}-wal`];
  for (const file of files) {
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // best effort cleanup
      }
    }
  }
}

function cleanupBackups() {
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

let prisma;
let Role;

test.before(async () => {
  cleanupDbFiles();
  cleanupBackups();
  const { applyMigrations } = await import("../../prisma/run-migrations.js");
  await applyMigrations();

  const prismaModule = await import("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient;
  Role = prismaModule.Role;
  prisma = new PrismaClient();
  await prisma.user.create({
    data: {
      username: "backup-admin",
      passwordHash: "hashed-value",
      role: Role.ADMIN,
      active: true
    }
  });
  await prisma.product.create({
    data: {
      name: "Backup Product",
      sku: `BK-SKU-${Date.now()}`,
      barcode: `BK-BAR-${Date.now()}`,
      category: "Testing",
      priceCents: 500,
      inventoryCount: 20,
      active: true
    }
  });
});

test.after(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
  cleanupDbFiles();
  cleanupBackups();
});

test("create logical backup with manifest metadata", async () => {
  const { filePath, backup } = await createLogicalBackup({
    db: prisma,
    outputDir: backupDir,
    environmentLabel: "backup-test-env",
    appVersion: "1.2.3",
    databaseProvider: "sqlite"
  });

  assert.ok(fs.existsSync(filePath));
  assert.equal(backup.manifest.environmentLabel, "backup-test-env");
  assert.equal(backup.manifest.databaseProvider, "sqlite");
  assert.equal(typeof backup.manifest.createdAtUtc, "string");
  assert.ok(Array.isArray(backup.data.products));
  assert.ok(backup.data.products.length >= 1);
});

test("restore logical backup and recover removed records", async () => {
  const backupResult = await createLogicalBackup({
    db: prisma,
    outputDir: backupDir,
    environmentLabel: "restore-drill",
    appVersion: "1.2.3",
    databaseProvider: "sqlite"
  });

  await prisma.product.deleteMany();
  assert.equal(await prisma.product.count(), 0);

  const restored = await restoreLogicalBackup({
    db: prisma,
    backup: backupResult.backup,
    confirm: true,
    requireConfirm: true,
    dryRun: false
  });

  assert.equal(restored.dryRun, false);
  assert.ok(await prisma.product.count() >= 1);
});

test("malformed backups fail validation and restore", async () => {
  const malformed = { manifest: { version: 999 }, data: {} };
  const validation = validateBackupDocument(malformed);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length >= 1);

  await assert.rejects(
    restoreLogicalBackup({
      db: prisma,
      backup: malformed,
      confirm: true,
      requireConfirm: true,
      dryRun: false
    }),
    /Invalid backup payload/
  );
});
