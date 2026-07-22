import { Server } from "@modelcontextprotocol/server";
import type { Notification } from "@modelcontextprotocol/server";
import type { Db, MongoClient } from "mongodb";
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
  options = {},
) {
  const server = new Server(
    {
      name: "mongodb",
      title: "MongoDB MCP Server",
      version: "2.1.1",
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
  server.setRequestHandler('ping', (request, ctx) =>
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
  server.setRequestHandler('resources/list', (request, ctx) =>
    handleListResourcesRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: ctx.mcpReq.signal,
    }),
  );

  /**
   * Handler for reading a collection's schema or contents.
   */
  server.setRequestHandler('resources/read', (request, ctx) =>
    handleReadResourceRequest({
      request,
      client,
      db,
      isReadOnlyMode,
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
  server.setRequestHandler('tools/list', (request, ctx) =>
    handleListToolsRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: ctx.mcpReq.signal,
    }),
  );

  /**
   * Handler for MongoDB tools.
   */
  server.setRequestHandler('tools/call', (request, ctx) =>
    handleCallToolRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      allowCrossDb,
      signal: ctx.mcpReq.signal,
    }),
  );

  /**
   * Handler that lists available prompts.
   */
  server.setRequestHandler('prompts/list', (request, ctx) =>
    handleListPromptsRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: ctx.mcpReq.signal,
    }),
  );

  /**
   * Handler for collection analysis prompt.
   */
  server.setRequestHandler('prompts/get', (request, ctx) =>
    handleGetPromptRequest({
      request,
      client,
      db,
      isReadOnlyMode,
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
  server.setRequestHandler(
    'resources/templates/list',
    (request, ctx) =>
      handleListResourceTemplatesRequest({
        request,
        client,
        db,
        isReadOnlyMode,
        signal: ctx.mcpReq.signal,
      }),
  );

  /**
   * Handler for completion requests.
   */
  server.setRequestHandler('completion/complete', (request, ctx) =>
    handleCompletionRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: ctx.mcpReq.signal,
    }),
  );

  return server;
}
