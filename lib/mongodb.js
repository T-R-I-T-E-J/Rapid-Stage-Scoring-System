import { MongoClient } from "mongodb";

const uri = process.env.MONGO_URL || "mongodb://127.0.0.1:27017";
const dbName = process.env.DB_NAME || "rapid_stage_scoring";

// Loud fail in production if MONGO_URL is missing or still pointing to localhost.
// Vercel/serverless can't reach 127.0.0.1 — this surfaces the misconfig clearly
// instead of producing a generic ECONNREFUSED that's easy to misread.
if (process.env.NODE_ENV === "production" && /^mongodb(?:\+srv)?:\/\/(?:127\.0\.0\.1|localhost)/i.test(uri)) {
  console.error(
    "[rsss] MONGO_URL is missing or points to localhost in production. " +
      "Set MONGO_URL to your MongoDB Atlas connection string in Vercel project env vars."
  );
}

async function connect() {
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  return client;
}

export async function getDb() {
  if (global._mongoClientPromise) {
    try {
      const client = await global._mongoClientPromise;
      return client.db(dbName);
    } catch {
      global._mongoClient = undefined;
      global._mongoClientPromise = undefined;
    }
  }
  global._mongoClientPromise = connect();
  const client = await global._mongoClientPromise;
  global._mongoClient = client;
  return client.db(dbName);
}
