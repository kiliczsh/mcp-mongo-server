#!/usr/bin/env node

/**
 * This is an MCP server that implements a MongoDB interface.
 * It demonstrates core MCP concepts by allowing:
 * - Listing collections as resources
 * - Reading collection schemas and contents
 * - Executing MongoDB queries via tools
 * - Providing collection summaries via prompts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema,
  PingRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MongoClient, ReadPreference } from "mongodb";
import { MongoCollection } from "./types.js";

/**
 * MongoDB connection client and database reference
 */
let client: MongoClient | null = null;
let db: any = null;
/**
 * Flag indicating whether the connection is in read-only mode
 */
let isReadOnlyMode = false;

/**
 * Create an MCP server with capabilities for resources (to list/read collections),
 * tools (to query data), and prompts (to analyze collections).
 */
const server = new Server(
  {
    name: "mongodb",
    version: "1.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  },
);

/**
 * Initialize MongoDB connection
 */
async function connectToMongoDB(url: string, readOnly: boolean = false) {
  try {
    const options = readOnly ? { readPreference: ReadPreference.SECONDARY } : {};
    client = new MongoClient(url, options);
    await client.connect();
    db = client.db();
    isReadOnlyMode = readOnly;
    return true;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    return false;
  }
}

/**
 * Handler for ping requests to check server health
 */
server.setRequestHandler(PingRequestSchema, async () => {
  try {
    // Check MongoDB connection
    if (!client) {
      throw new Error("MongoDB connection is not available");
    }

    // Ping MongoDB to verify connection
    await db.command({ ping: 1 });

    return {
      readOnlyMode: isReadOnlyMode
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`MongoDB ping failed: ${error.message}`);
    }
    throw new Error("MongoDB ping failed: Unknown error");
  }
});

/**
 * Handler for listing available collections as resources.
 * Each collection is exposed as a resource with:
 * - A mongodb:// URI scheme
 * - JSON MIME type
 * - Collection name and description
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    const collections = await db.listCollections().toArray();
    return {
      resources: collections.map((collection: MongoCollection) => ({
        uri: `mongodb:///${collection.name}`,
        mimeType: "application/json",
        name: collection.name,
        description: `MongoDB collection: ${collection.name}`,
      })),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to list collections: ${error.message}`);
    }
    throw new Error("Failed to list collections: Unknown error");
  }
});

/**
 * Handler for reading a collection's schema or contents.
 * Takes a mongodb:// URI and returns the collection info as JSON.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const collectionName = url.pathname.replace(/^\//, "");

  try {
    const collection = db.collection(collectionName);
    const sample = await collection.findOne({});
    const indexes = await collection.indexes();

    // Infer schema from sample document
    const schema = sample
      ? {
          type: "collection",
          name: collectionName,
          fields: Object.entries(sample).map(([key, value]) => ({
            name: key,
            type: typeof value,
          })),
          indexes: indexes.map((idx: any) => ({
            name: idx.name,
            keys: idx.key,
          })),
        }
      : {
          type: "collection",
          name: collectionName,
          fields: [],
          indexes: [],
        };

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(schema, null, 2),
        },
      ],
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to read collection ${collectionName}: ${error.message}`,
      );
    }
    throw new Error(
      `Failed to read collection ${collectionName}: Unknown error`,
    );
  }
});

/**
 * Handler that lists available tools.
 * Exposes MongoDB query tools for interacting with collections.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "query",
        description:
          "Execute a MongoDB query with optional execution plan analysis",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection to query",
            },
            filter: {
              type: "object",
              description: "MongoDB query filter",
            },
            projection: {
              type: "object",
              description: "Fields to include/exclude",
            },
            limit: {
              type: "number",
              description: "Maximum number of documents to return",
            },
            explain: {
              type: "string",
              description:
                "Optional: Get query execution information (queryPlanner, executionStats, or allPlansExecution)",
              enum: ["queryPlanner", "executionStats", "allPlansExecution"],
            },
          },
          required: ["collection"],
        },
      },
      {
        name: "aggregate",
        description:
          "Execute a MongoDB aggregation pipeline with optional execution plan analysis",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection to aggregate",
            },
            pipeline: {
              type: "array",
              description: "Aggregation pipeline stages",
            },
            explain: {
              type: "string",
              description:
                "Optional: Get aggregation execution information (queryPlanner, executionStats, or allPlansExecution)",
              enum: ["queryPlanner", "executionStats", "allPlansExecution"],
            },
          },
          required: ["collection", "pipeline"],
        },
      },
      {
        name: "update",
        description: "Update documents in a MongoDB collection",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection to update",
            },
            filter: {
              type: "object",
              description: "Filter to select documents to update",
            },
            update: {
              type: "object",
              description:
                "Update operations to apply ($set, $unset, $inc, etc.)",
            },
            upsert: {
              type: "boolean",
              description:
                "Create a new document if no documents match the filter",
            },
            multi: {
              type: "boolean",
              description: "Update multiple documents that match the filter",
            },
          },
          required: ["collection", "filter", "update"],
        },
      },
      {
        name: "serverInfo",
        description:
          "Get MongoDB server information including version, storage engine, and other details",
        inputSchema: {
          type: "object",
          properties: {
            includeDebugInfo: {
              type: "boolean",
              description:
                "Include additional debug information about the server",
            },
          },
        },
      },
      {
        name: "insert",
        description: "Insert one or more documents into a MongoDB collection",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection to insert into",
            },
            documents: {
              type: "array",
              description: "Array of documents to insert",
              items: {
                type: "object",
              },
            },
            ordered: {
              type: "boolean",
              description:
                "Optional: If true, perform an ordered insert of the documents. If false, perform an unordered insert",
            },
            writeConcern: {
              type: "object",
              description: "Optional: Write concern for the insert operation",
            },
            bypassDocumentValidation: {
              type: "boolean",
              description: "Optional: Allow insert to bypass schema validation",
            },
          },
          required: ["collection", "documents"],
        },
      },
      {
        name: "createIndex",
        description: "Create one or more indexes on a MongoDB collection",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection to create indexes on",
            },
            indexes: {
              type: "array",
              description: "Array of index specifications",
              items: {
                type: "object",
                properties: {
                  key: {
                    type: "object",
                    description:
                      "Index key pattern, e.g. { field: 1 } for ascending, { field: -1 } for descending",
                  },
                  name: {
                    type: "string",
                    description: "Optional: Name of the index",
                  },
                  unique: {
                    type: "boolean",
                    description: "Optional: If true, creates a unique index",
                  },
                  sparse: {
                    type: "boolean",
                    description: "Optional: If true, creates a sparse index",
                  },
                  background: {
                    type: "boolean",
                    description:
                      "Optional: If true, creates the index in the background",
                  },
                  expireAfterSeconds: {
                    type: "number",
                    description:
                      "Optional: Specifies the TTL for documents (time to live)",
                  },
                  partialFilterExpression: {
                    type: "object",
                    description:
                      "Optional: Filter expression for partial indexes",
                  },
                },
                required: ["key"],
              },
            },
            writeConcern: {
              type: "object",
              description: "Optional: Write concern for the index creation",
            },
            commitQuorum: {
              type: ["string", "number"],
              description:
                "Optional: Number of voting members required to create index",
            },
          },
          required: ["collection", "indexes"],
        },
      },
      {
        name: "count",
        description:
          "Count the number of documents in a collection that match a query",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection to count documents in",
            },
            query: {
              type: "object",
              description:
                "Optional: Query filter to select documents to count",
            },
            limit: {
              type: "integer",
              description: "Optional: Maximum number of documents to count",
            },
            skip: {
              type: "integer",
              description:
                "Optional: Number of documents to skip before counting",
            },
            hint: {
              type: "object",
              description: "Optional: Index hint to force query plan",
            },
            readConcern: {
              type: "object",
              description: "Optional: Read concern for the count operation",
            },
            maxTimeMS: {
              type: "integer",
              description: "Optional: Maximum time to allow the count to run",
            },
            collation: {
              type: "object",
              description: "Optional: Collation rules for string comparison",
            },
          },
          required: ["collection"],
        },
      },
      {
        name: "listCollections",
        description: "List all collections in the MongoDB database",
        inputSchema: {
          type: "object",
          properties: {
            nameOnly: {
              type: "boolean",
              description: "Optional: If true, returns only the collection names instead of full collection info"
            },
            filter: {
              type: "object", 
              description: "Optional: Filter to apply to the collections"
            }
          }
        }
      },
    ],
  };
});

/**
 * Handler for MongoDB tools.
 * Executes queries and returns results.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const collection = db.collection(request.params.arguments?.collection);
  
  // Define write operations that should be blocked in read-only mode
  const writeOperations = ['update', 'insert', 'createIndex'];
  
  // Check if the operation is a write operation and we're in read-only mode
  if (isReadOnlyMode && writeOperations.includes(request.params.name)) {
    throw new Error(`ReadonlyError: Operation '${request.params.name}' is not allowed in read-only mode`);
  }

  switch (request.params.name) {
    case "query": {
      const { filter, projection, limit, explain } =
        request.params.arguments || {};

      // Validate collection name to prevent access to system collections
      if (collection.collectionName.startsWith("system.")) {
        throw new Error("Access to system collections is not allowed");
      }

      // Validate and parse filter
      let queryFilter = {};
      if (filter) {
        if (typeof filter === "string") {
          try {
            queryFilter = JSON.parse(filter);
          } catch (e) {
            throw new Error(
              "Invalid filter format: must be a valid JSON object",
            );
          }
        } else if (
          typeof filter === "object" &&
          filter !== null &&
          !Array.isArray(filter)
        ) {
          queryFilter = filter;
        } else {
          throw new Error("Query filter must be a plain object or ObjectId");
        }
      }

      // Execute the find operation with error handling
      try {
        if (explain) {
          // Use explain for query analysis
          const explainResult = await collection
            .find(queryFilter, {
              projection,
              limit: limit || 100,
            })
            .explain(explain);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(explainResult, null, 2),
              },
            ],
          };
        } else {
          // Regular query execution
          const cursor = collection.find(queryFilter, {
            projection,
            limit: limit || 100,
          });
          const results = await cursor.toArray();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        }
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(
            `Failed to query collection ${collection.collectionName}: ${error.message}`,
          );
        }
        throw new Error(
          `Failed to query collection ${collection.collectionName}: Unknown error`,
        );
      }
    }

    case "aggregate": {
      const { pipeline, explain } = request.params.arguments || {};
      if (!Array.isArray(pipeline)) {
        throw new Error("Pipeline must be an array");
      }

      // Validate collection name to prevent access to system collections
      if (collection.collectionName.startsWith("system.")) {
        throw new Error("Access to system collections is not allowed");
      }

      // Execute the aggregation operation with error handling
      try {
        if (explain) {
          // Use explain for aggregation analysis
          const explainResult = await collection
            .aggregate(pipeline, {
              explain: {
                verbosity: explain,
              },
            })
            .toArray();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(explainResult, null, 2),
              },
            ],
          };
        } else {
          // Regular aggregation execution
          const results = await collection.aggregate(pipeline).toArray();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        }
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(
            `Failed to aggregate collection ${collection.collectionName}: ${error.message}`,
          );
        }
        throw new Error(
          `Failed to aggregate collection ${collection.collectionName}: Unknown error`,
        );
      }
    }

    case "update": {
      const { filter, update, upsert, multi } = request.params.arguments || {};

      // Validate collection name to prevent access to system collections
      if (collection.collectionName.startsWith("system.")) {
        throw new Error("Access to system collections is not allowed");
      }

      // Validate and parse filter
      let queryFilter = {};
      if (filter) {
        if (typeof filter === "string") {
          try {
            queryFilter = JSON.parse(filter);
          } catch (e) {
            throw new Error(
              "Invalid filter format: must be a valid JSON object",
            );
          }
        } else if (
          typeof filter === "object" &&
          filter !== null &&
          !Array.isArray(filter)
        ) {
          queryFilter = filter;
        } else {
          throw new Error("Query filter must be a plain object or ObjectId");
        }
      }

      // Validate update operations
      if (!update || typeof update !== "object" || Array.isArray(update)) {
        throw new Error("Update must be a valid MongoDB update document");
      }

      // Check if update operations use valid operators
      const validUpdateOperators = [
        "$set",
        "$unset",
        "$inc",
        "$push",
        "$pull",
        "$addToSet",
        "$pop",
        "$rename",
        "$mul",
      ];
      const hasValidOperator = Object.keys(update).some((key) =>
        validUpdateOperators.includes(key),
      );
      if (!hasValidOperator) {
        throw new Error(
          "Update must include at least one valid update operator ($set, $unset, etc.)",
        );
      }

      try {
        const options = {
          upsert: !!upsert,
          multi: !!multi,
        };

        // Use updateOne or updateMany based on multi option
        const updateMethod = options.multi ? "updateMany" : "updateOne";
        const result = await collection[updateMethod](
          queryFilter,
          update,
          options,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  matchedCount: result.matchedCount,
                  modifiedCount: result.modifiedCount,
                  upsertedCount: result.upsertedCount,
                  upsertedId: result.upsertedId,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(
            `Failed to update collection ${collection.collectionName}: ${error.message}`,
          );
        }
        throw new Error(
          `Failed to update collection ${collection.collectionName}: Unknown error`,
        );
      }
    }

    case "serverInfo": {
      const { includeDebugInfo } = request.params.arguments || {};

      try {
        // Get basic server information using buildInfo command
        const buildInfo = await db.command({ buildInfo: 1 });

        // Get additional server status if debug info is requested
        let serverStatus = null;
        if (includeDebugInfo) {
          serverStatus = await db.command({ serverStatus: 1 });
        }

        // Construct the response
        const serverInfo = {
          version: buildInfo.version,
          gitVersion: buildInfo.gitVersion,
          modules: buildInfo.modules,
          allocator: buildInfo.allocator,
          javascriptEngine: buildInfo.javascriptEngine,
          sysInfo: buildInfo.sysInfo,
          storageEngines: buildInfo.storageEngines,
          debug: buildInfo.debug,
          maxBsonObjectSize: buildInfo.maxBsonObjectSize,
          openssl: buildInfo.openssl,
          buildEnvironment: buildInfo.buildEnvironment,
          bits: buildInfo.bits,
          ok: buildInfo.ok,
          status: {},
          connectionInfo: {
            readOnlyMode: isReadOnlyMode,
            readPreference: isReadOnlyMode ? 'secondary' : 'primary'
          }
        };

        // Add server status information if requested
        if (serverStatus) {
          serverInfo.status = {
            host: serverStatus.host,
            version: serverStatus.version,
            process: serverStatus.process,
            pid: serverStatus.pid,
            uptime: serverStatus.uptime,
            uptimeMillis: serverStatus.uptimeMillis,
            uptimeEstimate: serverStatus.uptimeEstimate,
            localTime: serverStatus.localTime,
            connections: serverStatus.connections,
            network: serverStatus.network,
            memory: serverStatus.mem,
            storageEngine: serverStatus.storageEngine,
            security: serverStatus.security,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(serverInfo, null, 2),
            },
          ],
        };
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Failed to get server information: ${error.message}`);
        }
        throw new Error("Failed to get server information: Unknown error");
      }
    }

    case "insert": {
      const { documents, ordered, writeConcern, bypassDocumentValidation } =
        request.params.arguments || {};

      // Validate collection name to prevent access to system collections
      if (collection.collectionName.startsWith("system.")) {
        throw new Error("Access to system collections is not allowed");
      }

      // Validate documents array
      if (!Array.isArray(documents)) {
        throw new Error("Documents must be an array");
      }
      if (documents.length === 0) {
        throw new Error("Documents array cannot be empty");
      }
      if (
        !documents.every(
          (doc) => doc && typeof doc === "object" && !Array.isArray(doc),
        )
      ) {
        throw new Error(
          "Each document must be a valid MongoDB document object",
        );
      }

      try {
        // Prepare insert options
        const options = {
          ordered: ordered !== false, // default to true if not specified
          writeConcern,
          bypassDocumentValidation,
        };

        // Use insertMany for consistency, it works for single documents too
        const result = await collection.insertMany(documents, options);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  acknowledged: result.acknowledged,
                  insertedCount: result.insertedCount,
                  insertedIds: result.insertedIds,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        if (error instanceof Error) {
          // Handle bulk write errors specially to provide more detail
          if (error.name === "BulkWriteError") {
            const bulkError = error as any;
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "Bulk write error occurred",
                      writeErrors: bulkError.writeErrors,
                      insertedCount: bulkError.result?.nInserted || 0,
                      failedCount: bulkError.result?.nFailedInserts || 0,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
          throw new Error(
            `Failed to insert documents into collection ${collection.collectionName}: ${error.message}`,
          );
        }
        throw new Error(
          `Failed to insert documents into collection ${collection.collectionName}: Unknown error`,
        );
      }
    }

    case "createIndex": {
      const { indexes, writeConcern, commitQuorum } =
        request.params.arguments || {};

      // Validate collection name to prevent access to system collections
      if (collection.collectionName.startsWith("system.")) {
        throw new Error("Access to system collections is not allowed");
      }

      // Validate indexes array
      if (!Array.isArray(indexes) || indexes.length === 0) {
        throw new Error("Indexes must be a non-empty array");
      }

      // Validate writeConcern
      if (
        writeConcern &&
        (typeof writeConcern !== "object" || Array.isArray(writeConcern))
      ) {
        throw new Error(
          "Write concern must be a valid MongoDB write concern object",
        );
      }

      // Validate commitQuorum
      if (
        commitQuorum &&
        typeof commitQuorum !== "string" &&
        typeof commitQuorum !== "number"
      ) {
        throw new Error("Commit quorum must be a string or number");
      }

      try {
        const result = await collection.createIndexes(indexes, {
          writeConcern,
          commitQuorum:
            typeof commitQuorum === "number" ? commitQuorum : undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  acknowledged: result.acknowledged,
                  createdIndexes: result.createdIndexes,
                  numIndexesBefore: result.numIndexesBefore,
                  numIndexesAfter: result.numIndexesAfter,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(
            `Failed to create indexes on collection ${collection.collectionName}: ${error.message}`,
          );
        }
        throw new Error(
          `Failed to create indexes on collection ${collection.collectionName}: Unknown error`,
        );
      }
    }

    case "count": {
      const args = request.params.arguments || {};
      const { query } = args;

      // Validate collection name to prevent access to system collections
      if (collection.collectionName.startsWith("system.")) {
        throw new Error("Access to system collections is not allowed");
      }

      // Validate and parse query
      let countQuery = {};
      if (query) {
        if (typeof query === "string") {
          try {
            countQuery = JSON.parse(query);
          } catch (e) {
            throw new Error(
              "Invalid query format: must be a valid JSON object",
            );
          }
        } else if (
          typeof query === "object" &&
          query !== null &&
          !Array.isArray(query)
        ) {
          countQuery = query;
        } else {
          throw new Error("Query must be a plain object");
        }
      }

      try {
        // Prepare count options with proper typing
        interface CountOptions {
          limit?: number;
          skip?: number;
          hint?: object;
          readConcern?: object;
          maxTimeMS?: number;
          collation?: object;
          [key: string]: any;
        }

        const options: CountOptions = {
          limit: typeof args.limit === "number" ? args.limit : undefined,
          skip: typeof args.skip === "number" ? args.skip : undefined,
          hint:
            typeof args.hint === "object" && args.hint !== null
              ? args.hint
              : undefined,
          readConcern:
            typeof args.readConcern === "object" && args.readConcern !== null
              ? args.readConcern
              : undefined,
          maxTimeMS:
            typeof args.maxTimeMS === "number" ? args.maxTimeMS : undefined,
          collation:
            typeof args.collation === "object" && args.collation !== null
              ? args.collation
              : undefined,
        };

        // Remove undefined options
        Object.keys(options).forEach(
          (key) => options[key] === undefined && delete options[key],
        );

        // Execute count operation
        const count = await collection.countDocuments(countQuery, options);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  count: count,
                  ok: 1,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(
            `Failed to count documents in collection ${collection.collectionName}: ${error.message}`,
          );
        }
        throw new Error(
          `Failed to count documents in collection ${collection.collectionName}: Unknown error`,
        );
      }
    }

    case "listCollections": {
      const { nameOnly, filter } = request.params.arguments || {};
      
      try {
        // Get the list of collections
        const options = filter ? { filter } : {};
        const collections = await db.listCollections(options).toArray();
        
        // If nameOnly is true, return only the collection names
        const result = nameOnly
          ? collections.map((collection: any) => collection.name)
          : collections;
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Failed to list collections: ${error.message}`);
        }
        throw new Error("Failed to list collections: Unknown error");
      }
    }

    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

/**
 * Handler that lists available prompts.
 * Exposes prompts for analyzing collections.
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "analyze_collection",
        description: "Analyze a MongoDB collection structure and contents",
        arguments: [
          {
            name: "collection",
            description: "Name of the collection to analyze",
            required: true,
          },
        ],
      },
    ],
  };
});

/**
 * Handler for collection analysis prompt.
 * Returns a prompt that requests analysis of a collection's structure and data.
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "analyze_collection") {
    throw new Error("Unknown prompt");
  }

  const collectionName = request.params.arguments?.collection;
  if (!collectionName) {
    throw new Error("Collection name is required");
  }

  try {
    const collection = db.collection(collectionName);

    // Validate collection name to prevent access to system collections
    if (collection.collectionName.startsWith("system.")) {
      throw new Error("Access to system collections is not allowed");
    }

    const schema = await collection.findOne({});

    // Get basic collection stats - just count in API v1
    const stats = await collection
      .aggregate([
        {
          $collStats: {
            count: {},
          },
        },
      ])
      .toArray();

    // Also get a sample of documents to show data distribution
    const sampleDocs = await collection.find({}).limit(5).toArray();

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please analyze the following MongoDB collection:
Collection: ${collectionName}

Schema:
${JSON.stringify(schema, null, 2)}

Stats:
Document count: ${stats[0]?.count || "unknown"}

Sample documents:
${JSON.stringify(sampleDocs, null, 2)}`,
          },
        },
        {
          role: "user",
          content: {
            type: "text",
            text: "Provide insights about the collection's structure, data types, and basic statistics.",
          },
        },
      ],
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to analyze collection ${collectionName}: ${error.message}`,
      );
    } else {
      throw new Error(
        `Failed to analyze collection ${collectionName}: Unknown error`,
      );
    }
  }
});

/**
 * Handler for listing templates.
 * Exposes templates for constructing MongoDB queries.
 */
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return {
    resourceTemplates: [
      {
        name: "mongodb_query",
        description: "Template for constructing MongoDB queries",
        uriTemplate: "mongodb:///{collection}",
        text: `To query MongoDB collections, you can use these operators:

Filter operators:
- $eq: Matches values equal to a specified value
- $gt/$gte: Matches values greater than (or equal to) a specified value
- $lt/$lte: Matches values less than (or equal to) a specified value
- $in: Matches any of the values in an array
- $nin: Matches none of the values in an array
- $ne: Matches values not equal to a specified value
- $exists: Matches documents that have the specified field

Example queries:
1. Find documents where age > 21:
{ "age": { "$gt": 21 } }

2. Find documents with specific status:
{ "status": { "$in": ["active", "pending"] } }

3. Find documents with existing email:
{ "email": { "$exists": true } }

Use these patterns to construct MongoDB queries.`,
      },
    ],
  };
});

/**
 * Start the server using stdio transport and initialize MongoDB connection.
 */
async function main() {
  const args = process.argv.slice(2);
  let connectionUrl = '';
  let readOnlyMode = false;
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--read-only' || args[i] === '-r') {
      readOnlyMode = true;
    } else if (!connectionUrl) {
      connectionUrl = args[i];
    }
  }
  
  if (!connectionUrl) {
    console.error(
      "Please provide a MongoDB connection URL as a command-line argument"
    );
    console.error("Usage: command <mongodb-url> [--read-only|-r]");
    process.exit(1);
  }

  console.log(`Connecting to MongoDB${readOnlyMode ? ' in read-only mode' : ''}...`);
  const connected = await connectToMongoDB(connectionUrl, readOnlyMode);
  if (!connected) {
    console.error("Failed to connect to MongoDB");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Handle cleanup
process.on("SIGINT", async () => {
  if (client) {
    await client.close();
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (client) {
    await client.close();
  }
  process.exit(0);
});

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
