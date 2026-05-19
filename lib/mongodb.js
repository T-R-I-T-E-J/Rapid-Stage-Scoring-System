import { MongoClient } from "mongodb";

const uri = process.env.MONGO_URL || "mongodb://127.0.0.1:27017";
const dbName = process.env.DB_NAME || "rapid_stage_scoring";

async function connect() {
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  return client;
}

export async function getDb() {
  // Try the cached connection first. If it was previously rejected (e.g. Mongo
  // wasn't up when the server first booted), drop it and retry — otherwise we'd
  // forever re-await the same permanently-rejected promise.
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
