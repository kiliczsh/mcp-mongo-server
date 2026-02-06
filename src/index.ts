import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { MongoClient } from "mongodb";
import { connectToMongoDB } from "./mongo.js";
import { createServer } from "./server.js";

// Declare a client variable in the global scope for cleanup handlers
let mongoClient: MongoClient | null = null; // TODO: Fix Typescript error

/**
 * Start the server using stdio transport and initialize MongoDB connection.
 */
async function main() {
  const args = process.argv.slice(2);
  // Default to environment variables
  let connectionUrl = "";
  let readOnlyMode = process.env.MCP_MONGODB_READONLY === "true" || false;
  let transportMode: "stdio" | "http" = "stdio";
  let port = Number(process.env.MCP_PORT) || 3001;

  // Parse command line arguments (these take precedence)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--read-only" || args[i] === "-r") {
      readOnlyMode = true;
    } else if (args[i] === "--transport" || args[i] === "-t") {
      const value = args[++i];
      if (value !== "stdio" && value !== "http") {
        console.error("Invalid transport mode. Use 'stdio' or 'http'.");
        process.exit(1);
      }
      transportMode = value;
    } else if (args[i] === "--port" || args[i] === "-p") {
      port = Number(args[++i]);
      if (Number.isNaN(port)) {
        console.error("Invalid port number.");
        process.exit(1);
      }
    } else if (!connectionUrl) {
      connectionUrl = args[i];
    }
  }

  // If no connection URL from command line, use environment variable
  if (!connectionUrl) {
    connectionUrl = process.env.MCP_MONGODB_URI || "";
  }

  if (!connectionUrl) {
    console.error(
      "Please provide a MongoDB connection URL via command-line argument or MCP_MONGODB_URI environment variable",
    );
    console.error(
      "Usage: command <mongodb-url> [--read-only|-r] [--transport stdio|http] [--port 3001]",
    );
    console.error(
      "   or: MCP_MONGODB_URI=<mongodb-url> [MCP_MONGODB_READONLY=true] command",
    );
    process.exit(1);
  }

  // Ensure connection URL has the correct prefix
  if (
    !connectionUrl.startsWith("mongodb://") &&
    !connectionUrl.startsWith("mongodb+srv://")
  ) {
    console.error(
      "Invalid MongoDB connection URL. URL must start with 'mongodb://' or 'mongodb+srv://'",
    );
    process.exit(1);
  }

  try {
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

    if (transportMode === "http") {
      await startHttpServer(client, db, isReadOnlyMode, port);
    } else {
      await startStdioServer(client, db, isReadOnlyMode);
    }
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    if (mongoClient) {
      await mongoClient.close();
    }
    process.exit(1);
  }
}

/**
 * Start the server with stdio transport (default behavior).
 */
async function startStdioServer(
  client: MongoClient,
  db: import("mongodb").Db,
  isReadOnlyMode: boolean,
) {
  const server = createServer(client, db, isReadOnlyMode);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.warn("Server connected successfully via stdio");
}

/**
 * Start the server with Streamable HTTP transport.
 */
async function startHttpServer(
  client: MongoClient,
  db: import("mongodb").Db,
  isReadOnlyMode: boolean,
  port: number,
) {
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const method = req.method;
    const url = req.url;

    let mcpMethod = "-";
    if (req.body && typeof req.body === "object" && "method" in req.body) {
      mcpMethod = req.body.method;
    }

    res.on("finish", () => {
      const duration = Date.now() - start;
      console.log(
        `${new Date().toISOString()} | ${ip} | ${method} ${url} | ${res.statusCode} | ${duration}ms | mcp:${mcpMethod}`,
      );
    });

    next();
  });

  app.post("/mcp", async (req, res) => {
    const server = createServer(client, db, isReadOnlyMode);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (_req, res) => {
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      }),
    );
  });

  app.delete("/mcp", async (_req, res) => {
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      }),
    );
  });

  app.listen(port, () => {
    console.log(`MCP MongoDB Streamable HTTP Server listening on port ${port}`);
    console.log(`Endpoint: http://localhost:${port}/mcp`);
  });
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
