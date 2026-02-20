import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { applyMigrations } from "./run-migrations.js";
import { seedDatabase } from "./seed.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDatabasePath() {
  const databaseUrl = process.env.DATABASE_URL || "file:./dev.db";
  if (!databaseUrl.startsWith("file:")) {
    return null;
  }

  const rawPath = databaseUrl.slice("file:".length);
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  return path.resolve(__dirname, rawPath);
}

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

async function main() {
  const dbPath = resolveDatabasePath();

  if (!dbPath) {
    execSync("npx prisma migrate reset --force --skip-seed --schema prisma/schema.postgres.prisma", {
      stdio: "inherit",
      cwd: path.resolve(__dirname, "..")
    });
    await seedDatabase();
    return;
  }

  removeIfExists(dbPath);
  removeIfExists(`${dbPath}-journal`);
  removeIfExists(`${dbPath}-shm`);
  removeIfExists(`${dbPath}-wal`);

  const sessionsPath = path.resolve(process.cwd(), "sessions", "sessions.db");
  const legacySessionsPath = path.resolve(__dirname, "sessions.db");
  removeIfExists(sessionsPath);
  removeIfExists(`${sessionsPath}-journal`);
  removeIfExists(`${sessionsPath}-shm`);
  removeIfExists(`${sessionsPath}-wal`);
  removeIfExists(legacySessionsPath);
  removeIfExists(`${legacySessionsPath}-journal`);
  removeIfExists(`${legacySessionsPath}-shm`);
  removeIfExists(`${legacySessionsPath}-wal`);

  console.log("Removed existing SQLite files.");

  await applyMigrations();
  await seedDatabase();
}

main().catch((error) => {
  console.error("Reset failed", error);
  process.exitCode = 1;
});
