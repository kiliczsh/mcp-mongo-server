import type {
  ListToolsRequest,
  ListToolsResult,
} from "@modelcontextprotocol/server";
import type { Db, MongoClient } from "mongodb";

export async function handleListToolsRequest({
  request,
  client,
  db,
  isReadOnlyMode,
  signal,
  connectionSelection = false,
}: {
  request: ListToolsRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
  signal?: AbortSignal;
  connectionSelection?: boolean;
}): Promise<ListToolsResult> {
  const result: ListToolsResult = {
    tools: [
      {
        name: "query",
        description:
          "Find documents in one collection using a filter, projection, or sort. Use aggregate for grouping or joins. Request an execution plan to inspect the query.",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection to query",
            },
            filter: {
              type: "object",
              description:
                "MongoDB query filter. Supports date strings in ISO format ('2025-01-01T00:00:00Z') and ISODate('2025-01-01T00:00:00Z') notation",
            },
            projection: {
              type: "object",
              description: "Fields to include/exclude",
            },
            limit: {
              type: "number",
              description: "Maximum number of documents to return",
              default: 10,
            },
            skip: {
              type: "number",
              description:
                "Number of documents to skip before returning results",
              default: 0,
            },
            sort: {
              type: "object",
              description:
                "Sort order as a field-to-direction map, e.g. { orderDate: -1 } for descending or { name: 1 } for ascending",
            },
            explain: {
              type: "string",
              description: "Optional: Get query execution information",
              enum: ["queryPlanner", "executionStats", "allPlansExecution"],
            },
            objectIdMode: {
              type: "string",
              description: "Control how 24-character hex strings are handled",
              enum: ["auto", "none", "force"],
              default: "auto",
            },
          },
          required: ["collection"],
        },
      },
      {
        name: "aggregate",
        description:
          "Run a MongoDB aggregation pipeline for grouping, joins, or multi-stage transformations. Request an execution plan to inspect the pipeline.",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection to aggregate",
            },
            pipeline: {
              type: "array",
              description:
                "Aggregation pipeline stages. Supports date strings in ISO format ('2025-01-01T00:00:00Z') and ISODate('2025-01-01T00:00:00Z') notation",
              items: {
                type: "object",
              },
            },
            explain: {
              type: "string",
              description:
                "Optional: Get aggregation execution information (queryPlanner, executionStats, or allPlansExecution)",
              enum: ["queryPlanner", "executionStats", "allPlansExecution"],
            },
            objectIdMode: {
              type: "string",
              description: "Control how 24-character hex strings are handled",
              enum: ["auto", "none", "force"],
              default: "auto",
            },
          },
          required: ["collection", "pipeline"],
        },
      },
      {
        name: "update",
        description:
          "Modify matching documents using operators such as $set, $unset, or $inc. Enable multi to update all matches or upsert to create a document when the filter matches none.",
        inputSchema: {
          type: "object",
          properties: {
            collection: {
              type: "string",
              description: "Name of the collection to update",
            },
            filter: {
              type: "object",
              description:
                "Filter to select documents to update. Supports date strings in ISO format ('2025-01-01T00:00:00Z') and ISODate('2025-01-01T00:00:00Z') notation",
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
            objectIdMode: {
              type: "string",
              description: "Control how 24-character hex strings are handled",
              enum: ["auto", "none", "force"],
              default: "auto",
            },
          },
          required: ["collection", "filter", "update"],
        },
      },
      {
        name: "serverInfo",
        description:
          "Inspect MongoDB server metadata such as version and storage engine. Enable includeDebugInfo for additional diagnostics.",
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
        description:
          "Insert new documents into a MongoDB collection. Use update to modify existing records.",
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
              items: { type: "object" },
            },
            ordered: {
              type: "boolean",
              description:
                "If true, perform ordered insert. If false, insert unordered",
            },
            writeConcern: {
              type: "object",
              description: "Write concern for the insert operation",
            },
            bypassDocumentValidation: {
              type: "boolean",
              description: "Allow insert to bypass schema validation",
            },
            objectIdMode: {
              type: "string",
              description: "Control how 24-character hex strings are handled",
              enum: ["auto", "none", "force"],
              default: "auto",
            },
          },
          required: ["collection", "documents"],
        },
      },
      {
        name: "createIndex",
        description:
          "Create indexes to improve query performance, enforce uniqueness, or expire documents with a TTL index.",
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
                    description: "Index key pattern, e.g. { field: 1 }",
                  },
                  name: {
                    type: "string",
                    description: "Optional: Name of the index",
                  },
                  unique: {
                    type: "boolean",
                    description: "Optional: Creates a unique index",
                  },
                  sparse: {
                    type: "boolean",
                    description: "Optional: Creates a sparse index",
                  },
                  background: {
                    type: "boolean",
                    description: "Optional: Builds index in background",
                  },
                  expireAfterSeconds: {
                    type: "number",
                    description: "TTL in seconds for documents",
                  },
                  partialFilterExpression: {
                    type: "object",
                    description: "Filter expression for partial indexes",
                  },
                },
                required: ["key"],
              },
            },
            writeConcern: {
              type: "object",
              description: "Write concern for index creation",
            },
            commitQuorum: {
              type: ["string", "number"],
              description:
                "Replica-set commit quorum as a member count or a mode such as majority",
            },
            objectIdMode: {
              type: "string",
              description: "Control how 24-character hex strings are handled",
              enum: ["auto", "none", "force"],
              default: "auto",
            },
          },
          required: ["collection", "indexes"],
        },
      },
      {
        name: "count",
        description:
          "Count documents matching a filter in one collection. Use aggregate for counts grouped by field.",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string", description: "Collection name" },
            query: { type: "object", description: "Query filter to count" },
            limit: { type: "integer", description: "Max documents to count" },
            skip: {
              type: "integer",
              description: "Docs to skip before counting",
            },
            hint: { type: "object", description: "Index hint" },
            readConcern: { type: "object", description: "Read concern option" },
            maxTimeMS: { type: "integer", description: "Max execution time" },
            collation: {
              type: "object",
              description: "Collation rules for comparison",
            },
            objectIdMode: {
              type: "string",
              description: "Control how 24-character hex strings are handled",
              enum: ["auto", "none", "force"],
              default: "auto",
            },
          },
          required: ["collection"],
        },
      },
      {
        name: "listCollections",
        description:
          "List collections in the connected database. Filter by name or other collection properties and request names only for a compact result.",
        inputSchema: {
          type: "object",
          properties: {
            nameOnly: {
              type: "boolean",
              description: "If true, return only collection names",
            },
            filter: {
              type: "object",
              description: "Filter for collections",
            },
            skip: {
              type: "number",
              description:
                "Number of collections to skip before returning results",
              default: 0,
            },
            limit: {
              type: "number",
              description: "Maximum number of collections to return",
              default: 20,
            },
            objectIdMode: {
              type: "string",
              description: "Control how 24-character hex strings are handled",
              enum: ["auto", "none", "force"],
              default: "auto",
            },
          },
        },
      },
      {
        name: "convertTime",
        description:
          "Convert a Unix timestamp or date string to multiple formats (UTC ISO 8601, GMT, Unix seconds/milliseconds) and report the server's current time and timezone. Useful for building unambiguous date queries when the server and user are in different timezones. Omit 'input' to get the current time.",
        inputSchema: {
          type: "object",
          properties: {
            input: {
              type: "string",
              description:
                "A Unix timestamp (seconds or milliseconds, as a number or numeric string) or a date string (ISO 8601, with or without a timezone offset). Omit to use the current server time.",
            },
          },
        },
      },
    ],
  };
  const { tools } = result;
  if (connectionSelection) {
    const connectionId = {
      type: "string",
      description: "Configured connection ID. Defaults to default.",
    };
    const database = {
      type: "string",
      description:
        "Allowed database name. Defaults to the database in the connection URI.",
    };
    for (const tool of tools) {
      if (tool.name !== "convertTime") {
        tool.inputSchema.properties = {
          ...tool.inputSchema.properties,
          connectionId,
          database,
        };
      }
    }
    tools.push(
      {
        name: "listConnections",
        description:
          "List configured connection IDs, default databases, and read-only policies.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "listDatabases",
        description:
          "List existing authorized databases on a configured connection.",
        inputSchema: { type: "object", properties: { connectionId } },
      },
    );
  }
  return result;
}
