import type { PingRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Db, MongoClient } from "mongodb";

export async function handlePingRequest({
  request,
  client,
  db,
  isReadOnlyMode,
}: {
  request: PingRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
}) {
  try {
    // Check MongoDB connection
    if (!client) {
      throw new Error("MongoDB connection is not available");
    }
    // Ping MongoDB to verify connection
    await db.command({ ping: 1 });
    return {
      readOnlyMode: isReadOnlyMode,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`MongoDB ping failed: ${error.message}`);
    }
    throw new Error("MongoDB ping failed: Unknown error");
  }
}
