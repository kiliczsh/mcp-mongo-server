import type { ListToolsRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Db, MongoClient } from "mongodb";

export async function handleListToolsRequest({
  request,
  client,
  db,
  isReadOnlyMode,
  signal,
}: {
  request: ListToolsRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
  signal?: AbortSignal;
}) {
  return {
    tools: [
      {
        name: "query",
        description: `Execute a MongoDB find query to retrieve documents from a collection, with optional execution plan analysis.

Use when the user wants to read, search, or filter documents in a specific collection.
Do not use when you need to perform multi-stage data transformations (use aggregate instead) or when you want to modify data (use update or insert instead).
Accepts 'collection' (required), 'filter' (optional query object), 'projection' (optional field selection), 'limit' (optional, default 10), 'explain' (optional, for query plan analysis), and 'objectIdMode' (optional, default 'auto').
Raises an error if the collection does not exist or the filter syntax is invalid.`,
        execution: { taskSupport: "optional" },
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
        description: `Execute a MongoDB aggregation pipeline to perform multi-stage data transformations, grouping, joins, or analytics.

Use when the user needs $group, $lookup, $unwind, $match chains, or any computation that goes beyond simple filtering.
Do not use when a simple find query with filter and projection is sufficient (use query instead).
Accepts 'collection' (required), 'pipeline' (required, array of stage objects), 'explain' (optional, for execution plan analysis), and 'objectIdMode' (optional, default 'auto').
Raises an error if the pipeline syntax is invalid or a stage operator is unrecognized.`,
        execution: { taskSupport: "optional" },
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
        description: `Update one or more documents in a MongoDB collection using update operators ($set, $unset, $inc, etc.).

Use when the user wants to modify existing documents — change field values, increment counters, or remove fields.
Do not use when you need to add new documents (use insert instead) or when you need to read data (use query instead).
Accepts 'collection' (required), 'filter' (required), 'update' (required, update operators), 'upsert' (optional), 'multi' (optional, for updating multiple documents), and 'objectIdMode' (optional, default 'auto').
Raises an error if the filter or update syntax is invalid.`,
        execution: { taskSupport: "optional" },
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
        description: `Retrieve MongoDB server metadata including version, storage engine, host, and uptime.

Use when the user wants to check the database server version, verify the storage engine, or diagnose server-level configuration.
Do not use when you need to list collections (use listCollections instead) or query data (use query instead).
Accepts 'includeDebugInfo' (optional boolean, includes additional diagnostic details).
Raises an error if the server is unreachable.`,
        execution: { taskSupport: "optional" },
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
        description: `Insert one or more new documents into a MongoDB collection.

Use when the user wants to add new records, seed data, or create documents in a collection.
Do not use when you need to modify existing documents (use update instead) or when you need to read data (use query instead).
Accepts 'collection' (required), 'documents' (required, array of document objects), 'ordered' (optional), 'writeConcern' (optional), 'bypassDocumentValidation' (optional), and 'objectIdMode' (optional, default 'auto').
Raises an error if the collection name is invalid or document validation fails.`,
        execution: { taskSupport: "optional" },
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
        description: `Create one or more indexes on a MongoDB collection to improve query performance.

Use when the user wants to add indexes for frequently queried fields, enforce uniqueness, or set up TTL expiration on documents.
Do not use when you need to query or modify data (use query, update, or insert instead).
Accepts 'collection' (required), 'indexes' (required, array of index specs), 'writeConcern' (optional), 'commitQuorum' (optional), and 'objectIdMode' (optional, default 'auto'). Each index spec requires a 'key' and supports options like 'name', 'unique', 'sparse', 'background', 'expireAfterSeconds', and 'partialFilterExpression'.
Raises an error if the index key pattern is invalid or the collection does not exist.`,
        execution: { taskSupport: "optional" },
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
              type: "string",
              description: "Number of members required to create the index",
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
        description: `Count the number of documents in a collection that match a query filter.

Use when the user wants to know how many documents exist, check if data is present, or get collection statistics.
Do not use when you need to retrieve the actual documents (use query instead) or perform aggregation counts with grouping (use aggregate instead).
Accepts 'collection' (required), 'query' (optional filter), 'limit' (optional max count), 'skip' (optional docs to skip), 'hint' (optional), 'readConcern' (optional), 'maxTimeMS' (optional), 'collation' (optional), and 'objectIdMode' (optional, default 'auto').
Raises an error if the collection does not exist or the query filter is invalid.`,
        execution: { taskSupport: "optional" },
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
        description: `List all collections in the connected MongoDB database.

Use when the user wants to explore available collections before querying, or to verify a collection exists.
Do not use when you already know the collection name and need to query its documents (use query instead).
Accepts 'nameOnly' (optional boolean, returns only collection names for a compact listing), 'filter' (optional, to filter collections by properties), and 'objectIdMode' (optional, default 'auto').
Raises an error if the database connection is unavailable.`,
        execution: { taskSupport: "optional" },
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
    ],
  };
}
