import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { MasterAuthConfiguration } from "./masterSession";
import { normalizeMasterUsername } from "./masterSession";

const SCRYPT_KEY_LENGTH = 64;
const DEFAULT_SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

interface ParsedPasswordHash {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  digest: Buffer;
}

export async function hashMasterPassword(
  password: string,
  { cost = DEFAULT_SCRYPT_COST, salt = randomBytes(24) }: { cost?: number; salt?: Buffer } = {},
) {
  assertPasswordStrength(password);
  validateScryptCost(cost);
  const digest = await derivePassword(password, salt, cost, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION);
  return [
    "scrypt",
    String(cost),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELIZATION),
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

export async function verifyMasterCredentials(
  username: string,
  password: string,
  configuration: MasterAuthConfiguration,
) {
  const parsedHash = parsePasswordHash(configuration.passwordHash);
  const candidateDigest = await derivePassword(
    password,
    parsedHash.salt,
    parsedHash.cost,
    parsedHash.blockSize,
    parsedHash.parallelization,
  );
  const usernameMatches = constantTimeTextEqual(
    normalizeMasterUsername(username),
    configuration.username,
  );
  const passwordMatches = candidateDigest.length === parsedHash.digest.length
    && timingSafeEqual(candidateDigest, parsedHash.digest);
  return usernameMatches && passwordMatches;
}

export function assertPasswordStrength(password: string) {
  if (password.length < 14) {
    throw new Error("The master password must contain at least 14 characters.");
  }
  if (password.length > 1_024) {
    throw new Error("The master password is too long.");
  }
}

function parsePasswordHash(value: string): ParsedPasswordHash {
  const [algorithm, costValue, blockSizeValue, parallelizationValue, saltValue, digestValue, extra] = value.split("$");
  const cost = Number(costValue);
  const blockSize = Number(blockSizeValue);
  const parallelization = Number(parallelizationValue);
  if (
    algorithm !== "scrypt"
    || extra !== undefined
    || !saltValue
    || !digestValue
    || !Number.isInteger(cost)
    || !Number.isInteger(blockSize)
    || !Number.isInteger(parallelization)
  ) {
    throw new Error("MASTER_AUTH_PASSWORD_HASH is invalid.");
  }
  validateScryptCost(cost);
  if (blockSize !== SCRYPT_BLOCK_SIZE || parallelization !== SCRYPT_PARALLELIZATION) {
    throw new Error("MASTER_AUTH_PASSWORD_HASH uses unsupported scrypt parameters.");
  }

  const salt = Buffer.from(saltValue, "base64url");
  const digest = Buffer.from(digestValue, "base64url");
  if (salt.length < 16 || digest.length !== SCRYPT_KEY_LENGTH) {
    throw new Error("MASTER_AUTH_PASSWORD_HASH is invalid.");
  }
  return { cost, blockSize, parallelization, salt, digest };
}

async function derivePassword(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
) {
  return await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, SCRYPT_KEY_LENGTH, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function validateScryptCost(cost: number) {
  if (cost < 16_384 || cost > 131_072 || (cost & (cost - 1)) !== 0) {
    throw new Error("The scrypt cost must be a power of two between 16384 and 131072.");
  }
}

function constantTimeTextEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
