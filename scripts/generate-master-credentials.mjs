import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const username = normalizeUsername(process.argv[2] ?? "anda-admin");
if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
  throw new Error("Username must contain 3-64 letters, numbers, dots, underscores, or hyphens.");
}

const suppliedPassword = process.env.MASTER_AUTH_NEW_PASSWORD;
const password = suppliedPassword || randomBytes(18).toString("base64url");
if (password.length < 14 || password.length > 1_024) {
  throw new Error("MASTER_AUTH_NEW_PASSWORD must contain between 14 and 1024 characters.");
}

const cost = 32_768;
const blockSize = 8;
const parallelization = 1;
const salt = randomBytes(24);
const digest = await scrypt(password, salt, 64, {
  N: cost,
  r: blockSize,
  p: parallelization,
  maxmem: 64 * 1024 * 1024,
});
const passwordHash = [
  "scrypt",
  String(cost),
  String(blockSize),
  String(parallelization),
  salt.toString("base64url"),
  Buffer.from(digest).toString("base64url"),
].join("$");
const sessionSecret = randomBytes(48).toString("base64url");

console.log("Add these server-only values to the target environment:");
console.log(`MASTER_AUTH_USERNAME=${username}`);
console.log(`MASTER_AUTH_PASSWORD_HASH=${passwordHash}`);
console.log(`MASTER_AUTH_SESSION_SECRET=${sessionSecret}`);
console.log("MASTER_AUTH_SESSION_HOURS=12");
if (!suppliedPassword) {
  console.log("");
  console.log("Generated password (shown once):");
  console.log(password);
}

function normalizeUsername(value) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}
