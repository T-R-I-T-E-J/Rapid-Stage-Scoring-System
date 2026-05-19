import { sql } from "@vercel/postgres";

// Schema is bootstrapped lazily on the first DB call after a cold start.
// IF NOT EXISTS makes this idempotent — safe to run on every cold start.
// Cached on `global` so warm function invocations skip the round-trip.
async function ensureSchema() {
  if (global._rsssSchemaReady) return;

  await sql`
    CREATE TABLE IF NOT EXISTS admins (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS athletes (
      id UUID PRIMARY KEY,
      full_name TEXT NOT NULL,
      competitor_number INT UNIQUE NOT NULL CHECK (competitor_number BETWEEN 1 AND 8),
      country TEXT NOT NULL DEFAULT '',
      photo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','eliminated')),
      eliminated_after_round INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS scores (
      athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
      round INT NOT NULL CHECK (round BETWEEN 1 AND 10),
      score NUMERIC(3,1) NOT NULL CHECK (score >= 0 AND score <= 5),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, round)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      current_round INT NOT NULL DEFAULT 0 CHECK (current_round BETWEEN 0 AND 10)
    )
  `;

  await sql`
    INSERT INTO settings (id, current_round) VALUES ('main', 0)
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS competitions (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      current_round INT NOT NULL,
      athletes JSONB NOT NULL
    )
  `;

  global._rsssSchemaReady = true;
}

export async function getSql() {
  await ensureSchema();
  return sql;
}

// Re-export sql for direct use after ensureSchema has been called once.
export { sql };
