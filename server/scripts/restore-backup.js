import path from "node:path";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { logger } from "../src/logging/logger.js";
import { readBackupFile, restoreLogicalBackup } from "../src/backup/backupService.js";

function parseArgs(argv) {
  const args = {
    file: "",
    confirm: false,
    dryRun: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--file" && argv[index + 1]) {
      args.file = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--confirm") {
      args.confirm = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    throw new Error("Missing --file argument.");
  }

  const backupFile = path.resolve(process.cwd(), args.file);
  const backup = readBackupFile(backupFile);

  const result = await restoreLogicalBackup({
    db: prisma,
    backup,
    confirm: args.confirm,
    requireConfirm: config.restoreRequireConfirm,
    dryRun: args.dryRun
  });

  logger.info(
    {
      eventType: "backup_restored",
      filePath: backupFile,
      dryRun: result.dryRun,
      counts: result.counts
    },
    result.dryRun ? "Restore dry run completed" : "Backup restored"
  );

  // eslint-disable-next-line no-console
  console.log(
    result.dryRun
      ? `Restore dry run succeeded: ${backupFile}`
      : `Restore completed from backup: ${backupFile}`
  );
}

main()
  .catch((error) => {
    logger.error({ err: error, eventType: "backup_restore_failed" }, "Backup restore failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
