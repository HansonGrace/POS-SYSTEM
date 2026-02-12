import argon2 from "argon2";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

function addPepper(plaintextPassword, pepper) {
  return `${plaintextPassword}${pepper}`;
}

export async function hashArgon2id(plaintextPassword, config) {
  return argon2.hash(addPepper(plaintextPassword, config.pepper), {
    type: argon2.argon2id,
    memoryCost: config.argon2.memoryCost,
    timeCost: config.argon2.timeCost,
    parallelism: config.argon2.parallelism,
    hashLength: config.argon2.hashLength
  });
}

export async function verifyArgon2id(storedHash, plaintextPassword, config) {
  return argon2.verify(storedHash, addPepper(plaintextPassword, config.pepper), {
    type: argon2.argon2id
  });
}

function parsePbkdf2Hash(storedHash) {
  const parts = storedHash.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2") {
    return null;
  }

  const [, digest, iterationsRaw, saltB64, derivedB64] = parts;
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return null;
  }

  return {
    digest,
    iterations,
    salt: Buffer.from(saltB64, "base64"),
    derivedKey: Buffer.from(derivedB64, "base64")
  };
}

export async function verifyLegacy(storedHash, algo, plaintextPassword, config) {
  const pepperedPassword = addPepper(plaintextPassword, config.pepper);

  if (algo === "bcrypt") {
    return bcrypt.compare(pepperedPassword, storedHash);
  }

  if (algo === "pbkdf2_sha256") {
    const parsed = parsePbkdf2Hash(storedHash);
    if (!parsed) {
      return false;
    }

    const calculated = await new Promise((resolve, reject) => {
      crypto.pbkdf2(
        pepperedPassword,
        parsed.salt,
        parsed.iterations,
        parsed.derivedKey.length,
        parsed.digest,
        (error, output) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(output);
        }
      );
    });

    const calculatedBuffer = Buffer.from(calculated);
    if (calculatedBuffer.length !== parsed.derivedKey.length) {
      return false;
    }

    return crypto.timingSafeEqual(calculatedBuffer, parsed.derivedKey);
  }

  return false;
}

export async function createLegacyHashForTests(algo, plaintextPassword, pepper) {
  const pepperedPassword = addPepper(plaintextPassword, pepper);

  if (algo === "bcrypt") {
    return bcrypt.hash(pepperedPassword, 12);
  }

  if (algo === "pbkdf2_sha256") {
    const salt = crypto.randomBytes(16);
    const iterations = 210000;
    const digest = "sha256";
    const derivedKey = await new Promise((resolve, reject) => {
      crypto.pbkdf2(pepperedPassword, salt, iterations, 32, digest, (error, output) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(output);
      });
    });

    return [
      "pbkdf2",
      digest,
      String(iterations),
      salt.toString("base64"),
      Buffer.from(derivedKey).toString("base64")
    ].join("$");
  }

  throw new Error(`Unsupported legacy algorithm: ${algo}`);
}

