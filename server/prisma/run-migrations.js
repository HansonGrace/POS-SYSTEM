import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";

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

function execSql(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

function allSql(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

export async function applyMigrations() {
  const dbPath = resolveDatabasePath();
  if (!dbPath) {
    execSync("npx prisma migrate deploy --schema prisma/schema.postgres.prisma", {
      stdio: "inherit",
      cwd: path.resolve(__dirname, "..")
    });
    return;
  }

  const migrationsDir = path.resolve(__dirname, "migrations");

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new sqlite3.Database(dbPath);

  try {
    await execSql(
      db,
      `CREATE TABLE IF NOT EXISTS __manual_migrations (
        name TEXT PRIMARY KEY,
        appliedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );`
    );

    const appliedRows = await allSql(db, "SELECT name FROM __manual_migrations;");
    const applied = new Set(appliedRows.map((row) => row.name));

    const migrationFolders = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const folderName of migrationFolders) {
      const migrationFile = path.join(migrationsDir, folderName, "migration.sql");
      if (!fs.existsSync(migrationFile) || applied.has(folderName)) {
        continue;
      }

      const sql = fs.readFileSync(migrationFile, "utf8");

      await execSql(db, "BEGIN;");
      try {
        await execSql(db, sql);
        await runSql(
          db,
          "INSERT INTO __manual_migrations (name, appliedAt) VALUES (?, datetime('now'));",
          [folderName]
        );
        await execSql(db, "COMMIT;");
        console.log(`Applied migration ${folderName}`);
      } catch (migrationError) {
        await execSql(db, "ROLLBACK;");
        throw migrationError;
      }
    }

    console.log(`Migrations complete. Database: ${dbPath}`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyMigrations().catch((error) => {
    console.error("Migration failed", error);
    process.exitCode = 1;
  });
}
