import type { PingRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Db, MongoClient } from "mongodb";

export async function handlePingRequest({
  request,
  client,
  db,
  isReadOnlyMode,
  signal,
}: {
  request: PingRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
  signal?: AbortSignal;
}) {
  try {
    // Check MongoDB connection
    if (!client) {
      throw new Error("MongoDB connection is not available");
    }

    // Ping MongoDB to verify connection
    signal?.throwIfAborted();
    const pong = await db.command({ ping: 1 });

    if (pong.ok !== 1) {
      throw new Error(`MongoDB ping failed: ${pong.errmsg}`);
    }

    return {};
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`MongoDB ping failed: ${error.message}`);
    }
    throw new Error("MongoDB ping failed: Unknown error");
  }
}
