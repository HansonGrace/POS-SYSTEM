import path from "node:path";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { createLogicalBackup } from "../src/backup/backupService.js";
import { logger } from "../src/logging/logger.js";

function parseArgs(argv) {
  const args = {
    outDir: config.backupDir,
    envLabel: config.backupEnvLabel
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out-dir" && argv[index + 1]) {
      args.outDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--env-label" && argv[index + 1]) {
      args.envLabel = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const outputDir = path.resolve(process.cwd(), args.outDir);

  const { filePath, backup } = await createLogicalBackup({
    db: prisma,
    outputDir,
    environmentLabel: args.envLabel,
    appVersion: config.appVersion,
    databaseProvider: config.databaseProvider
  });

  logger.info(
    {
      eventType: "backup_created",
      filePath,
      environmentLabel: args.envLabel,
      counts: backup.counts
    },
    "Logical backup created"
  );

  // eslint-disable-next-line no-console
  console.log(`Backup created: ${filePath}`);
}

main()
  .catch((error) => {
    logger.error({ err: error, eventType: "backup_create_failed" }, "Backup creation failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
