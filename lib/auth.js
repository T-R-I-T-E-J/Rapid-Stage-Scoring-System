import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-rss-jwt-secret-dev-only";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const BCRYPT_ROUNDS = 10;

const BOOTSTRAP_USER = process.env.ADMIN_USER || "admin";
const BOOTSTRAP_PASS = process.env.ADMIN_PASS || "admin123";

/**
 * Ensure at least one admin exists in the `admins` collection.
 * On first run, seed from env. Idempotent — does nothing if any admin exists.
 */
export async function bootstrapAdmins(db) {
  const count = await db.collection("admins").countDocuments({});
  if (count > 0) return;
  const passwordHash = await bcrypt.hash(BOOTSTRAP_PASS, BCRYPT_ROUNDS);
  await db.collection("admins").insertOne({
    id: uuidv4(),
    username: BOOTSTRAP_USER,
    passwordHash,
    createdAt: new Date().toISOString(),
  });
}

export async function verifyCredentials(db, username, password) {
  await bootstrapAdmins(db);
  const admin = await db.collection("admins").findOne({ username });
  if (!admin) return null;
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return null;
  return { id: admin.id, username: admin.username };
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function extractBearer(req) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return "";
  return h.slice(7).trim();
}
