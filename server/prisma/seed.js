import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import path from "node:path";
import { config } from "../src/config.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const SALT_ROUNDS = 10;
const generatedCredentials = [];

const products = [
  { name: "Whole Milk 1L", category: "Grocery", sku: "GRC-1001", barcode: "1001001", priceCents: 329, inventoryCount: 80 },
  { name: "Brown Eggs 12pk", category: "Grocery", sku: "GRC-1002", barcode: "1001002", priceCents: 449, inventoryCount: 65 },
  { name: "White Bread", category: "Grocery", sku: "GRC-1003", barcode: "1001003", priceCents: 299, inventoryCount: 90 },
  { name: "Peanut Butter 16oz", category: "Grocery", sku: "GRC-1004", barcode: "1001004", priceCents: 579, inventoryCount: 50 },
  { name: "Jasmine Rice 5lb", category: "Grocery", sku: "GRC-1005", barcode: "1001005", priceCents: 999, inventoryCount: 40 },
  { name: "Olive Oil 500ml", category: "Grocery", sku: "GRC-1006", barcode: "1001006", priceCents: 1199, inventoryCount: 35 },
  { name: "Cola Can 12oz", category: "Beverages", sku: "BEV-2001", barcode: "2002001", priceCents: 149, inventoryCount: 150 },
  { name: "Orange Juice 1L", category: "Beverages", sku: "BEV-2002", barcode: "2002002", priceCents: 429, inventoryCount: 70 },
  { name: "Sparkling Water Lime", category: "Beverages", sku: "BEV-2003", barcode: "2002003", priceCents: 199, inventoryCount: 120 },
  { name: "Iced Coffee Bottle", category: "Beverages", sku: "BEV-2004", barcode: "2002004", priceCents: 359, inventoryCount: 85 },
  { name: "Green Tea 500ml", category: "Beverages", sku: "BEV-2005", barcode: "2002005", priceCents: 249, inventoryCount: 95 },
  { name: "Energy Drink 16oz", category: "Beverages", sku: "BEV-2006", barcode: "2002006", priceCents: 329, inventoryCount: 78 },
  { name: "Sea Salt Chips", category: "Snacks", sku: "SNK-3001", barcode: "3003001", priceCents: 279, inventoryCount: 110 },
  { name: "Trail Mix 8oz", category: "Snacks", sku: "SNK-3002", barcode: "3003002", priceCents: 599, inventoryCount: 60 },
  { name: "Chocolate Bar", category: "Snacks", sku: "SNK-3003", barcode: "3003003", priceCents: 199, inventoryCount: 180 },
  { name: "Protein Bar", category: "Snacks", sku: "SNK-3004", barcode: "3003004", priceCents: 249, inventoryCount: 140 },
  { name: "Pretzel Sticks", category: "Snacks", sku: "SNK-3005", barcode: "3003005", priceCents: 229, inventoryCount: 125 },
  { name: "Popcorn Butter", category: "Snacks", sku: "SNK-3006", barcode: "3003006", priceCents: 259, inventoryCount: 88 },
  { name: "Paper Towels 6pk", category: "Household", sku: "HSE-4001", barcode: "4004001", priceCents: 899, inventoryCount: 50 },
  { name: "Dish Soap 20oz", category: "Household", sku: "HSE-4002", barcode: "4004002", priceCents: 379, inventoryCount: 75 },
  { name: "Laundry Detergent 50oz", category: "Household", sku: "HSE-4003", barcode: "4004003", priceCents: 1299, inventoryCount: 42 },
  { name: "Trash Bags 30ct", category: "Household", sku: "HSE-4004", barcode: "4004004", priceCents: 1099, inventoryCount: 58 },
  { name: "All Purpose Cleaner", category: "Household", sku: "HSE-4005", barcode: "4004005", priceCents: 499, inventoryCount: 64 },
  { name: "Toilet Paper 12pk", category: "Household", sku: "HSE-4006", barcode: "4004006", priceCents: 1399, inventoryCount: 47 },
  { name: "Bananas 1lb", category: "Produce", sku: "PRD-5001", barcode: "5005001", priceCents: 99, inventoryCount: 130 },
  { name: "Apples Gala 1lb", category: "Produce", sku: "PRD-5002", barcode: "5005002", priceCents: 199, inventoryCount: 115 },
  { name: "Tomatoes 1lb", category: "Produce", sku: "PRD-5003", barcode: "5005003", priceCents: 249, inventoryCount: 100 },
  { name: "Avocado Each", category: "Produce", sku: "PRD-5004", barcode: "5005004", priceCents: 179, inventoryCount: 98 },
  { name: "Bell Peppers", category: "Produce", sku: "PRD-5005", barcode: "5005005", priceCents: 299, inventoryCount: 84 },
  { name: "Carrots 2lb", category: "Produce", sku: "PRD-5006", barcode: "5005006", priceCents: 269, inventoryCount: 76 }
];

const registers = [
  { identifier: "MAIN", name: "Front Register" }
];

const customers = [
  { name: "Ava Collins", email: "ava.collins@example.com", phone: "555-0101" },
  { name: "Liam Bennett", email: "liam.bennett@example.com", phone: "555-0102" },
  { name: "Noah Turner", email: "noah.turner@example.com", phone: "555-0103" },
  { name: "Mia Rivera", email: "mia.rivera@example.com", phone: "555-0104" }
];

function randomLabPassword() {
  // Controlled lab-only credential flow. Do not enable this outside dedicated non-production training environments.
  return randomBytes(12).toString("base64url");
}

async function seedUsers(prisma) {
  if (String(process.env.SEED_LAB_USERS || "false").toLowerCase() !== "true") {
    console.log("SEED_LAB_USERS is not true. Skipping seeded lab credentials.");
    return;
  }

  if (!config.labAllowDefaultCredentials) {
    console.log(
      "SEED_LAB_USERS is true but LAB_ALLOW_DEFAULT_CREDENTIALS is not set. " +
        "Skipping default credential creation for safety."
    );
    return;
  }

  const useRandomPasswords = config.labSeedRandomPasswords;
  const allUsers = [
    { username: "admin", role: Role.ADMIN, password: useRandomPasswords ? randomLabPassword() : "admin" },
    ...Array.from({ length: 10 }, (_, index) => {
      const n = index + 1;
      const username = `user${n}`;
      return {
        username,
        role: Role.CASHIER,
        password: useRandomPasswords ? randomLabPassword() : username
      };
    })
  ];

  if (useRandomPasswords) {
    console.log("LAB_SEED_RANDOM_PASSWORDS enabled: generated one-time lab credentials:");
    for (const user of allUsers) {
      console.log(` - ${user.username}: ${user.password}`);
      generatedCredentials.push(`${user.username}=${user.password}`);
    }
  } else {
    console.log(
      "LAB_ALLOW_DEFAULT_CREDENTIALS is true and LAB_SEED_RANDOM_PASSWORDS is false. " +
        "Using deterministic credentials (admin/admin and user1/user1 ...)."
    );
  }

  if (!config.labMode) {
    console.log("LAB_MODE is false. No lab users were seeded.");
    return;
  }

  for (const user of allUsers) {
    const passwordHash = await bcrypt.hash(user.password, SALT_ROUNDS);

    await prisma.user.upsert({
      where: { username: user.username },
      update: { passwordHash, role: user.role, active: true, failedLogins: 0, lockedUntil: null },
      create: {
        username: user.username,
        passwordHash,
        role: user.role,
        active: true,
        failedLogins: 0
      }
    });
  }
}

async function seedProducts(prisma) {
  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {
        ...product,
        active: true
      },
      create: {
        ...product,
        active: true
      }
    });
  }
}

async function seedCustomers(prisma) {
  for (const customer of customers) {
    await prisma.customer.upsert({
      where: { email: customer.email },
      update: customer,
      create: customer
    });
  }
}

async function seedRegisters(prisma) {
  for (const register of registers) {
    await prisma.register.upsert({
      where: { identifier: register.identifier },
      update: {
        name: register.name,
        active: true
      },
      create: {
        ...register,
        name: register.name,
        active: true
      }
    });
  }
}

export async function seedDatabase() {
  const prisma = new PrismaClient();

  try {
    await seedUsers(prisma);
    await seedProducts(prisma);
    await seedCustomers(prisma);
    await seedRegisters(prisma);
    console.log("Seed completed: products, customers, and registers. Lab users are opt-in via SEED_LAB_USERS=true.");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDatabase().catch((error) => {
    console.error("Seed failed", error);
    process.exitCode = 1;
  });
}
