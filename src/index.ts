#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectToMongoDB } from "./mongo.js";
import { createServer } from "./server.js";
import { MongoClient } from "mongodb";

// Declare a client variable in the global scope for cleanup handlers
let mongoClient: MongoClient | null = null; // TODO: Fix Typescript error

/**
 * Start the server using stdio transport and initialize MongoDB connection.
 */
async function main() {
  const args = process.argv.slice(2);
  let connectionUrl = "";
  let readOnlyMode = false;

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--read-only" || args[i] === "-r") {
      readOnlyMode = true;
    } else if (!connectionUrl) {
      connectionUrl = args[i];
    }
  }

  if (!connectionUrl) {
    console.error(
      "Please provide a MongoDB connection URL as a command-line argument",
    );
    console.error("Usage: command <mongodb-url> [--read-only|-r]");
    process.exit(1);
  }

  const { client, db, isConnected, isReadOnlyMode } = await connectToMongoDB(
    connectionUrl,
    readOnlyMode,
  );

  // Store client in global variable for cleanup
  mongoClient = client;

  if (!isConnected || !client || !db) {
    console.error("Failed to connect to MongoDB");
    process.exit(1);
  }

  // Pass db instead of client to createServer
  const server = createServer(client, db, isReadOnlyMode);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Handle cleanup
process.on("SIGINT", async () => {
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
