import fs from "node:fs";
import path from "node:path";

const BACKUP_VERSION = 1;

const tablePlan = [
  { key: "users", delegate: "user", orderBy: { id: "asc" } },
  { key: "products", delegate: "product", orderBy: { id: "asc" } },
  { key: "customers", delegate: "customer", orderBy: { id: "asc" } },
  { key: "paymentMethods", delegate: "paymentMethod", orderBy: { id: "asc" } },
  { key: "registers", delegate: "register", orderBy: { id: "asc" } },
  { key: "registerSessions", delegate: "registerSession", orderBy: { id: "asc" } },
  { key: "cashDrawerEvents", delegate: "cashDrawerEvent", orderBy: { id: "asc" } },
  { key: "suspendedSales", delegate: "suspendedSale", orderBy: { id: "asc" } },
  { key: "orders", delegate: "order", orderBy: { id: "asc" } },
  { key: "orderItems", delegate: "orderItem", orderBy: { id: "asc" } },
  { key: "transactions", delegate: "transaction", orderBy: { id: "asc" } },
  { key: "transactionItems", delegate: "transactionItem", orderBy: { id: "asc" } },
  { key: "transactionDiscounts", delegate: "transactionDiscount", orderBy: { id: "asc" } },
  { key: "transactionTaxes", delegate: "transactionTax", orderBy: { id: "asc" } },
  { key: "transactionPayments", delegate: "transactionPayment", orderBy: { id: "asc" } },
  { key: "paymentAttempts", delegate: "paymentAttempt", orderBy: { id: "asc" } },
  { key: "paymentStatusHistory", delegate: "paymentStatusHistory", orderBy: { id: "asc" } },
  { key: "returns", delegate: "return", orderBy: { id: "asc" } },
  { key: "refunds", delegate: "refund", orderBy: { id: "asc" } },
  { key: "receipts", delegate: "receipt", orderBy: { id: "asc" } },
  { key: "transactionStatusHistory", delegate: "transactionStatusHistory", orderBy: { id: "asc" } },
  { key: "auditLogs", delegate: "auditLog", orderBy: { id: "asc" } }
];

const deletionOrder = [...tablePlan]
  .reverse()
  .map((table) => table.delegate);

function timestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function validateBackupDocument(document) {
  const errors = [];

  if (!document || typeof document !== "object") {
    errors.push("Backup must be an object.");
    return { valid: false, errors };
  }

  if (!document.manifest || typeof document.manifest !== "object") {
    errors.push("Backup manifest is missing.");
  } else {
    if (document.manifest.version !== BACKUP_VERSION) {
      errors.push(`Unsupported backup version: ${document.manifest.version}`);
    }
    if (!document.manifest.createdAtUtc) {
      errors.push("manifest.createdAtUtc is required.");
    }
    if (!document.manifest.environmentLabel) {
      errors.push("manifest.environmentLabel is required.");
    }
    if (!document.manifest.databaseProvider) {
      errors.push("manifest.databaseProvider is required.");
    }
  }

  if (!document.data || typeof document.data !== "object") {
    errors.push("Backup data is missing.");
  } else {
    for (const table of tablePlan) {
      if (!Array.isArray(document.data[table.key])) {
        errors.push(`Backup data array missing: ${table.key}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function createLogicalBackup({
  db,
  outputDir,
  environmentLabel,
  appVersion,
  databaseProvider
}) {
  const data = {};
  const counts = {};

  for (const table of tablePlan) {
    // Keep logical backup deterministic and diff-friendly by sorting by primary key.
    const rows = await db[table.delegate].findMany({ orderBy: table.orderBy });
    data[table.key] = rows;
    counts[table.key] = rows.length;
  }

  const backup = {
    manifest: {
      version: BACKUP_VERSION,
      createdAtUtc: new Date().toISOString(),
      environmentLabel,
      databaseProvider,
      appVersion
    },
    counts,
    data
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.resolve(outputDir, `rangepos-backup-${timestampForFileName()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), "utf8");

  return { filePath, backup };
}

async function restoreRows(tx, delegate, rows) {
  if (!rows.length) {
    return;
  }

  await tx[delegate].createMany({
    data: rows
  });
}

export async function restoreLogicalBackup({
  db,
  backup,
  confirm = false,
  requireConfirm = true,
  dryRun = false
}) {
  const validation = validateBackupDocument(backup);
  if (!validation.valid) {
    const message = `Invalid backup payload: ${validation.errors.join("; ")}`;
    const error = new Error(message);
    error.code = "INVALID_BACKUP";
    throw error;
  }

  if (requireConfirm && !confirm) {
    const error = new Error("Restore confirmation is required. Re-run with --confirm.");
    error.code = "RESTORE_CONFIRMATION_REQUIRED";
    throw error;
  }

  const counts = Object.fromEntries(tablePlan.map((table) => [table.key, backup.data[table.key].length]));
  if (dryRun) {
    return {
      dryRun: true,
      restoredAt: new Date().toISOString(),
      counts
    };
  }

  await db.$transaction(async (tx) => {
    for (const delegate of deletionOrder) {
      await tx[delegate].deleteMany();
    }

    for (const table of tablePlan) {
      await restoreRows(tx, table.delegate, backup.data[table.key]);
    }
  });

  return {
    dryRun: false,
    restoredAt: new Date().toISOString(),
    counts
  };
}

export function readBackupFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}
