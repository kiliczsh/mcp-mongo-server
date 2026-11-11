import {
  ProtocolError,
  ProtocolErrorCode,
  Server,
} from "@modelcontextprotocol/server";
import type { Notification } from "@modelcontextprotocol/server";
import type { Db, MongoClient } from "mongodb";
import { type Connections, resourceSelectors } from "./connections.js";
import type { QueryLimits } from "./query-limits.js";
import { handleCallToolRequest } from "./schemas/call.js";
import { handleCompletionRequest } from "./schemas/completion.js";
import { handlePingRequest } from "./schemas/ping.js";
import {
  handleGetPromptRequest,
  handleListPromptsRequest,
} from "./schemas/prompts.js";
import {
  handleListResourcesRequest,
  handleReadResourceRequest,
} from "./schemas/resource.js";
import { handleListResourceTemplatesRequest } from "./schemas/templates.js";
import { handleListToolsRequest } from "./schemas/tools.js";
import { decodeCursor, encodeCursor, paginate } from "./utils/pagination.js";

export type SendProgressFn = (
  progress: number,
  total: number,
  message?: string,
) => Promise<void>;

// Build a progress reporter bound to the request's progressToken. Returns
// undefined when the client did not request progress. In v2 the reporter emits
// via the per-request notify surface (ctx.mcpReq.notify).
function createSendProgress(
  progressToken: string | number | undefined,
  notify: (notification: Notification) => Promise<void>,
): SendProgressFn | undefined {
  if (progressToken === undefined) return undefined;
  return (progress, total, message) =>
    notify({
      method: "notifications/progress",
      params: { progressToken, progress, total, message },
    });
}

/**
 * Create an MCP server with capabilities for resources (to list/read collections),
 * tools (to query data), and prompts (to analyze collections).
 */
export function createServer(
  client: MongoClient,
  db: Db,
  isReadOnlyMode = false,
  allowCrossDb = false,
  allowServerJs = false,
  options = {},
  connections?: Connections,
  queryLimits?: QueryLimits,
) {
  const defaultTarget = { client, db, isReadOnlyMode };
  const server = new Server(
    {
      name: "mongodb",
      title: "MongoDB MCP Server",
      version: "3.2.0",
      description:
        "MCP server for MongoDB: query, aggregate, and manage collections with read-only mode, progress notifications, and cancellation",
      websiteUrl: "https://github.com/kiliczsh/mcp-mongo-server",
      ...options,
    },
    {
      capabilities: {
        completions: {},
        resources: {},
        tools: {},
        prompts: {},
      },
      ...options,
    },
  );

  /**
   * Handler for ping requests to check server health
   */
  server.setRequestHandler("ping", (request, ctx) =>
    handlePingRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: ctx.mcpReq.signal,
    }),
  );

  /**
   * Handler for listing available collections as resources.
   */
  server.setRequestHandler("resources/list", (request, ctx) => {
    if (connections?.named) {
      return listNamedResources(
        connections,
        request.params?.cursor,
        ctx.mcpReq.signal,
      );
    }
    return handleListResourcesRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: ctx.mcpReq.signal,
    });
  });

  /**
   * Handler for reading a collection's schema or contents.
   */
  server.setRequestHandler("resources/read", async (request, ctx) =>
    handleReadResourceRequest({
      request,
      ...(connections
        ? await connections.resolve(resourceSelectors(request.params.uri))
        : defaultTarget),
      signal: ctx.mcpReq.signal,
      sendProgress: createSendProgress(
        request.params._meta?.progressToken,
        ctx.mcpReq.notify,
      ),
    }),
  );

  /**
   * Handler that lists available tools.
   */
  server.setRequestHandler("tools/list", (request, ctx) =>
    handleListToolsRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      connectionSelection: !!connections,
      hasWritableConnection: connections
        ?.list()
        .some(({ readOnly }) => !readOnly),
      queryLimits,
      signal: ctx.mcpReq.signal,
    }),
  );

  /**
   * Handler for MongoDB tools.
   */
  server.setRequestHandler("tools/call", (request, ctx) =>
    handleCallToolRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      allowCrossDb,
      allowServerJs,
      connections,
      queryLimits,
      signal: ctx.mcpReq.signal,
    }),
  );

  /**
   * Handler that lists available prompts.
   */
  server.setRequestHandler("prompts/list", (request, ctx) =>
    handleListPromptsRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      connectionSelection: !!connections,
      signal: ctx.mcpReq.signal,
    }),
  );

  /**
   * Handler for collection analysis prompt.
   */
  server.setRequestHandler("prompts/get", async (request, ctx) =>
    handleGetPromptRequest({
      request,
      ...(connections
        ? await connections.resolve(request.params.arguments)
        : defaultTarget),
      showTarget: !!connections?.named,
      signal: ctx.mcpReq.signal,
      sendProgress: createSendProgress(
        request.params._meta?.progressToken,
        ctx.mcpReq.notify,
      ),
    }),
  );

  /**
   * Handler for listing templates.
   */
  server.setRequestHandler("resources/templates/list", async (request, ctx) => {
    const result = await handleListResourceTemplatesRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: ctx.mcpReq.signal,
    });
    if (connections?.named) {
      result.resourceTemplates.push({
        ...result.resourceTemplates[0],
        name: "mongodb_connection_collection",
        uriTemplate: "mongodb:///{collection}{?connectionId,database}",
      });
    }
    return result;
  });

  /**
   * Handler for completion requests.
   */
  server.setRequestHandler("completion/complete", async (request, ctx) => {
    const { ref, argument, context } = request.params;
    const selectors = {
      ...context?.arguments,
      ...(ref.type === "ref/resource" ? resourceSelectors(ref.uri) : {}),
    };
    if (
      connections &&
      (argument.name === "connectionId" || argument.name === "database")
    ) {
      const candidates =
        argument.name === "connectionId"
          ? connections.list().map(({ connectionId }) => connectionId)
          : await connections.listDatabases(selectors.connectionId);
      const matches = candidates.filter((value) =>
        value.startsWith(argument.value),
      );
      return {
        completion: {
          values: matches.slice(0, 100),
          total: matches.length,
          hasMore: matches.length > 100,
        },
      };
    }
    return handleCompletionRequest({
      request,
      ...(connections ? await connections.resolve(selectors) : defaultTarget),
      signal: ctx.mcpReq.signal,
    });
  });

  return server;
}

async function listNamedResources(
  connections: Connections,
  cursor?: string,
  signal?: AbortSignal,
) {
  const prefix = `${connections.cursorScope}.`;
  const offsetCursor = cursor?.slice(prefix.length);
  const offset = decodeCursor(offsetCursor);
  if (
    cursor !== undefined &&
    (!cursor.startsWith(prefix) ||
      !Number.isSafeInteger(offset) ||
      encodeCursor(offset) !== offsetCursor)
  ) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      "Invalid resource cursor for the current connection configuration",
    );
  }
  const resources = [];
  for (const { connectionId, defaultDatabase } of connections.list()) {
    try {
      signal?.throwIfAborted();
      for (const database of await connections.listDatabases(connectionId)) {
        const { db } = await connections.resolve({ connectionId, database });
        const collections = await db
          .listCollections({}, { nameOnly: true })
          .toArray();
        for (const name of collections.map(({ name }) => name).sort()) {
          if (name.startsWith("system.")) continue;
          const query =
            connectionId === "default" && database === defaultDatabase
              ? ""
              : `?${new URLSearchParams({ connectionId, database })}`;
          resources.push({
            uri: `mongodb:///${encodeURIComponent(name)}${query}`,
            name,
            mimeType: "application/json",
            description: `MongoDB collection: ${connectionId}/${database}/${name}`,
          });
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        `Failed to list resources for MongoDB connection '${connectionId}'`,
      );
    }
  }
  const { items, nextCursor } = paginate(resources, offsetCursor);
  return {
    resources: items,
    ...(nextCursor ? { nextCursor: prefix + nextCursor } : {}),
  };
}
