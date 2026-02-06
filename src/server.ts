import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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

/**
 * Create an MCP server with capabilities for resources (to list/read collections),
 * tools (to query data), and prompts (to analyze collections).
 */
export function createServer(
  client: MongoClient,
  db: Db,
  isReadOnlyMode = false,
  options = {},
) {
  const server = new Server(
    {
      name: "mongodb",
      version: "2.0.2",
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
  server.setRequestHandler(PingRequestSchema, (request, extra) =>
    handlePingRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: extra.signal,
    }),
  );

  /**
   * Handler for listing available collections as resources.
   */
  server.setRequestHandler(ListResourcesRequestSchema, (request, extra) =>
    handleListResourcesRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: extra.signal,
    }),
  );

  /**
   * Handler for reading a collection's schema or contents.
   */
  server.setRequestHandler(ReadResourceRequestSchema, (request, extra) =>
    handleReadResourceRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: extra.signal,
    }),
  );

  /**
   * Handler that lists available tools.
   */
  server.setRequestHandler(ListToolsRequestSchema, (request, extra) =>
    handleListToolsRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: extra.signal,
    }),
  );

  /**
   * Handler for MongoDB tools.
   */
  server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    handleCallToolRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: extra.signal,
    }),
  );

  /**
   * Handler that lists available prompts.
   */
  server.setRequestHandler(ListPromptsRequestSchema, (request, extra) =>
    handleListPromptsRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: extra.signal,
    }),
  );

  /**
   * Handler for collection analysis prompt.
   */
  server.setRequestHandler(GetPromptRequestSchema, (request, extra) =>
    handleGetPromptRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: extra.signal,
    }),
  );

  /**
   * Handler for listing templates.
   */
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    (request, extra) =>
      handleListResourceTemplatesRequest({
        request,
        client,
        db,
        isReadOnlyMode,
        signal: extra.signal,
      }),
  );

  /**
   * Handler for completion requests.
   */
  server.setRequestHandler(CompleteRequestSchema, (request, extra) =>
    handleCompletionRequest({
      request,
      client,
      db,
      isReadOnlyMode,
      signal: extra.signal,
    }),
  );

  return server;
}
