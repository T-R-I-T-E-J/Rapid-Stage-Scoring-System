import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { sql } from "./db";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-rss-jwt-secret-dev-only";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const BCRYPT_ROUNDS = 10;

const BOOTSTRAP_USER = process.env.ADMIN_USER || "admin";
const BOOTSTRAP_PASS = process.env.ADMIN_PASS || "admin123";

// Idempotent. Seeds an admin from env if the admins table is empty.
export async function bootstrapAdmins() {
  const { rows } = await sql`SELECT COUNT(*)::int AS c FROM admins`;
  if (rows[0].c > 0) return;
  const passwordHash = await bcrypt.hash(BOOTSTRAP_PASS, BCRYPT_ROUNDS);
  await sql`
    INSERT INTO admins (id, username, password_hash)
    VALUES (${uuidv4()}, ${BOOTSTRAP_USER}, ${passwordHash})
    ON CONFLICT (username) DO NOTHING
  `;
}

export async function verifyCredentials(username, password) {
  await bootstrapAdmins();
  const { rows } = await sql`SELECT id, username, password_hash FROM admins WHERE username = ${username} LIMIT 1`;
  if (!rows.length) return null;
  const admin = rows[0];
  const ok = await bcrypt.compare(password, admin.password_hash);
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
