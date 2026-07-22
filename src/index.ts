import { timingSafeEqual } from "node:crypto";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
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
  let allowCrossDb = process.env.MCP_MONGODB_ALLOW_CROSS_DB === "true" || false;
  let allowServerJs =
    process.env.MCP_MONGODB_ALLOW_SERVER_JS === "true" || false;
  let transportMode: "stdio" | "http" = "stdio";
  let port = Number(process.env.MCP_PORT) || 3001;
  const allowedOrigins = (process.env.MCP_HTTP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  // Max HTTP request body size. Defaults to 10mb to match the stdio transport's
  // buffer, instead of Express's surprisingly low 100kb default.
  let jsonLimit = process.env.MCP_HTTP_JSON_LIMIT || "10mb";
  // Optional static bearer token for the HTTP transport. When set, every
  // request must carry `Authorization: Bearer <token>`. Empty = no auth.
  let authToken = process.env.MCP_HTTP_AUTH_TOKEN || "";

  // Parse command line arguments (these take precedence)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--read-only" || args[i] === "-r") {
      readOnlyMode = true;
    } else if (args[i] === "--allow-cross-db") {
      allowCrossDb = true;
    } else if (args[i] === "--allow-server-js") {
      allowServerJs = true;
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
    } else if (args[i] === "--allowed-origins") {
      allowedOrigins.push(
        ...(args[++i] || "")
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      );
    } else if (args[i] === "--json-limit") {
      const value = args[++i];
      if (value) jsonLimit = value;
    } else if (args[i] === "--auth-token") {
      const value = args[++i];
      if (value) authToken = value;
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
      await startHttpServer(
        client,
        db,
        isReadOnlyMode,
        allowCrossDb,
        allowServerJs,
        port,
        allowedOrigins,
        jsonLimit,
        authToken,
      );
    } else {
      await startStdioServer(
        client,
        db,
        isReadOnlyMode,
        allowCrossDb,
        allowServerJs,
      );
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
  allowCrossDb: boolean,
  allowServerJs: boolean,
) {
  // serveStdio owns the era decision: a 2026-07-28 client opening is served the
  // modern protocol, a 2025-era opening is served via the legacy shim — one
  // factory, both eras.
  serveStdio(() =>
    createServer(client, db, isReadOnlyMode, allowCrossDb, allowServerJs),
  );
  console.warn("Server connected successfully via stdio");
}

/**
 * Check whether a request Origin is acceptable. Requests without an Origin
 * header (non-browser clients like CLIs and IDEs) are always allowed;
 * browser requests are only allowed from localhost origins or an explicit
 * allowlist. This protects against DNS rebinding attacks, where a malicious
 * website tricks a browser into sending requests to a locally running server.
 */
function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/**
 * Validate an `Authorization: Bearer <token>` header against the expected
 * token using a constant-time comparison to avoid leaking it via timing.
 */
function bearerTokenValid(
  authorization: string | undefined,
  expected: string,
): boolean {
  const prefix = "Bearer ";
  if (!authorization || !authorization.startsWith(prefix)) {
    return false;
  }
  const provided = Buffer.from(authorization.slice(prefix.length));
  const wanted = Buffer.from(expected);
  return (
    provided.length === wanted.length && timingSafeEqual(provided, wanted)
  );
}

/**
 * Start the server with Streamable HTTP transport.
 */
async function startHttpServer(
  client: MongoClient,
  db: import("mongodb").Db,
  isReadOnlyMode: boolean,
  allowCrossDb: boolean,
  allowServerJs: boolean,
  port: number,
  allowedOrigins: string[],
  jsonLimit: string,
  authToken: string,
) {
  const app = createMcpExpressApp({ host: "0.0.0.0", jsonLimit });

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

  // Origin validation: reject invalid origins with 403 Forbidden as required
  // by the Streamable HTTP transport spec (DNS rebinding protection)
  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    if (!isOriginAllowed(origin, allowedOrigins)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Forbidden: origin not allowed",
        },
        id: null,
      });
      return;
    }
    next();
  });

  // Optional bearer-token auth: when a token is configured, every request must
  // present it. Invalid or missing tokens get a 401 with a Bearer challenge, as
  // required by the MCP authorization spec (RFC 6750 / OAuth 2.1 Section 5.3).
  if (authToken) {
    app.use((req, res, next) => {
      if (!bearerTokenValid(req.headers.authorization, authToken)) {
        res
          .status(401)
          .set("WWW-Authenticate", 'Bearer realm="mcp", error="invalid_token"')
          .json({
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: "Unauthorized: missing or invalid bearer token",
            },
            id: null,
          });
        return;
      }
      next();
    });
  }

  // Modern stateless MCP handler: one factory serves both the 2026-07-28 and
  // legacy (2025-era) protocols per request. toNodeHandler adapts the
  // fetch-shaped handler to Express, forwarding the body express.json() parsed.
  const mcpHandler = createMcpHandler((_ctx) =>
    createServer(client, db, isReadOnlyMode, allowCrossDb, allowServerJs),
  );
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => console.error("Error handling MCP request:", error),
  });

  app.all("/mcp", (req, res) => nodeHandler(req, res, req.body));

  // Turn body-parser failures (payload too large, malformed JSON) into
  // JSON-RPC errors instead of Express's default HTML error page.
  app.use(
    (
      err: { type?: string; status?: number; statusCode?: number; message?: string },
      _req: unknown,
      res: {
        headersSent: boolean;
        status: (code: number) => { json: (body: unknown) => void };
      },
      next: (err?: unknown) => void,
    ) => {
      if (res.headersSent) return next(err);
      const status = err.status ?? err.statusCode ?? 400;
      const tooLarge = err.type === "entity.too.large" || status === 413;
      res.status(tooLarge ? 413 : 400).json({
        jsonrpc: "2.0",
        error: {
          code: tooLarge ? -32600 : -32700,
          message: tooLarge
            ? "Request body exceeds the configured size limit"
            : `Invalid request body: ${err.message ?? "parse error"}`,
        },
        id: null,
      });
    },
  );

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
