import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import dotenv from "dotenv";
import path from "node:path";
import { isPasswordAllowed } from "../src/security/passwords.js";
import { config } from "../src/config.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

async function promptForCredentials() {
  const usernameFromEnv = process.env.CREATE_ADMIN_USERNAME?.trim().toLowerCase();
  const passwordFromEnv = process.env.CREATE_ADMIN_PASSWORD;

  if (usernameFromEnv && passwordFromEnv) {
    return { username: usernameFromEnv, password: passwordFromEnv };
  }

  const rl = createInterface({ input, output });
  try {
    const username = (await rl.question("Admin username: ")).trim().toLowerCase();
    const password = await rl.question("Admin password: ");
    return { username, password };
  } finally {
    rl.close();
  }
}

async function main() {
  const { username, password } = await promptForCredentials();

  if (!username || !password) {
    throw new Error("Username and password are required.");
  }

  if (!isPasswordAllowed(password)) {
    throw new Error(
      `Password must be at least ${config.passwordMinLength} characters when weak passwords are disabled.`
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { username },
    update: {
      role: Role.ADMIN,
      passwordHash,
      active: true,
      failedLogins: 0,
      lockedUntil: null,
      lastFailedLoginAt: null
    },
    create: {
      username,
      passwordHash,
      role: Role.ADMIN,
      active: true
    },
    select: {
      id: true,
      username: true,
      role: true,
      active: true
    }
  });

  console.log(`Admin user ready: ${admin.username} (id=${admin.id})`);
}

main()
  .catch((error) => {
    console.error("Failed to create admin user:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
