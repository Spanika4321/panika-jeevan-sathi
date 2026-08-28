import crypto from "crypto";

const HASH_ITERATIONS = 120_000;
const HASH_KEY_LENGTH = 64;
const HASH_DIGEST = "sha512";

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_DIGEST).toString("hex");
  return `pbkdf2_${HASH_DIGEST}$${HASH_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [algorithm, iterationsText, salt, originalHash] = storedHash.split("$");
  if (!algorithm?.startsWith("pbkdf2_") || !iterationsText || !salt || !originalHash) return false;
  const digest = algorithm.replace("pbkdf2_", "");
  const iterations = Number.parseInt(iterationsText, 10);
  if (!Number.isFinite(iterations)) return false;
  const attempted = crypto
    .pbkdf2Sync(password, salt, iterations, Buffer.from(originalHash, "hex").length, digest)
    .toString("hex");
  const original = Buffer.from(originalHash, "hex");
  const candidate = Buffer.from(attempted, "hex");
  return original.length === candidate.length && crypto.timingSafeEqual(original, candidate);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function addDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function isStrongPassword(password: string) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
