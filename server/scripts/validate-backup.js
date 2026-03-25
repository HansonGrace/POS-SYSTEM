import path from "node:path";
import { readBackupFile, validateBackupDocument } from "../src/backup/backupService.js";

function parseArgs(argv) {
  const args = {
    file: ""
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--file" && argv[index + 1]) {
      args.file = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    throw new Error("Missing --file argument.");
  }

  const backupFile = path.resolve(process.cwd(), args.file);
  const backup = readBackupFile(backupFile);
  const validation = validateBackupDocument(backup);

  if (!validation.valid) {
    // eslint-disable-next-line no-console
    console.error("Backup validation failed:");
    for (const error of validation.errors) {
      // eslint-disable-next-line no-console
      console.error(` - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`Backup is valid: ${backupFile}`);
}

try {
  main();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(`Validation failed: ${error.message}`);
  process.exitCode = 1;
}
