import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type {
  Db,
  MongoClient,
  Filter,
  Document,
  FindOptions,
  BulkWriteOptions,
  WriteConcern,
  CreateIndexesOptions,
  CollationOptions,
  CountDocumentsOptions,
  ReadConcernLike,
  Collection,
} from "mongodb";

// MongoDB return type interfaces
interface CreateIndexesResult {
  acknowledged: boolean;
  createdIndexes: string[];
  numIndexesBefore: number;
  numIndexesAfter: number;
}

interface BulkWriteError extends Error {
  name: string;
  writeErrors?: Array<unknown>;
  result?: {
    nInserted?: number;
    nFailedInserts?: number;
  };
}

// Define supported operations
type MongoOperation =
  | "query"
  | "aggregate"
  | "update"
  | "serverInfo"
  | "insert"
  | "createIndex"
  | "count"
  | "listCollections";

// Define operations that require a collection
const COLLECTION_OPERATIONS = [
  "query",
  "aggregate",
  "update",
  "insert",
  "createIndex",
  "count",
];

// Define write operations that are blocked in read-only mode
const WRITE_OPERATIONS = ["update", "insert", "createIndex"];

export async function handleCallToolRequest({
  request,
  client,
  db,
  isReadOnlyMode,
}: {
  request: CallToolRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
}) {
  const { name, arguments: args = {} } = request.params;
  const operation = name as MongoOperation;

  // Validate operation name
  validateOperation(operation);

  // Check if operation is allowed in read-only mode
  checkReadOnlyMode(operation, isReadOnlyMode);

  // Get collection only if the operation requires it
  let collection: Collection<Document> | null = null;

  if (COLLECTION_OPERATIONS.includes(operation)) {
    const collectionName = args.collection as string;

    if (!collectionName) {
      throw new Error(
        `Collection name is required for '${operation}' operation`,
      );
    }

    collection = db.collection(collectionName);

    // Validate collection
    validateCollection(collection);
  }

  // Route to the appropriate handler based on operation name
  switch (operation) {
    case "query":
      return handleQuery(collection, args);
    case "aggregate":
      return handleAggregate(collection, args);
    case "update":
      return handleUpdate(collection, args);
    case "serverInfo":
      return handleServerInfo(db, isReadOnlyMode, args);
    case "insert":
      return handleInsert(collection, args);
    case "createIndex":
      return handleCreateIndex(collection, args);
    case "count":
      return handleCount(collection, args);
    case "listCollections":
      return handleListCollections(db, args);
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

// Helper functions

function validateOperation(operation: MongoOperation): void {
  const validOperations = [
    "query",
    "aggregate",
    "update",
    "serverInfo",
    "insert",
    "createIndex",
    "count",
    "listCollections",
  ];

  if (!validOperations.includes(operation)) {
    throw new Error(`Unknown operation: ${operation}`);
  }
}

function validateCollection(collection: Collection<Document>): void {
  if (!collection.collectionName) {
    throw new Error("Collection name cannot be empty");
  }
  if (collection.collectionName.startsWith("system.")) {
    throw new Error("Access to system collections is not allowed");
  }
}

function checkReadOnlyMode(operation: string, isReadOnlyMode: boolean): void {
  if (isReadOnlyMode && WRITE_OPERATIONS.includes(operation)) {
    throw new Error(
      `ReadonlyError: Operation '${operation}' is not allowed in read-only mode`,
    );
  }
}

function parseFilter(filter: unknown): Filter<Document> {
  if (!filter) {
    return {};
  }

  if (typeof filter === "string") {
    try {
      return JSON.parse(filter);
    } catch (e) {
      throw new Error("Invalid filter format: must be a valid JSON object");
    }
  }

  if (typeof filter === "object" && filter !== null && !Array.isArray(filter)) {
    return filter as Filter<Document>;
  }

  throw new Error("Query filter must be a plain object or ObjectId");
}

function formatResponse(data: unknown): {
  content: [{ type: string; text: string }];
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function handleError(
  error: unknown,
  operation: string,
  collectionName?: string,
): never {
  const context = collectionName ? `collection ${collectionName}` : "operation";

  if (error instanceof Error) {
    throw new Error(`Failed to ${operation} ${context}: ${error.message}`);
  }

  throw new Error(`Failed to ${operation} ${context}: Unknown error`);
}

// Operation handlers

async function handleQuery(
  collection: Collection<Document> | null,
  args: Record<string, unknown>,
) {
  if (!collection) {
    throw new Error("Collection is required for query operation");
  }
  const { filter, projection, limit, explain } = args;
  const queryFilter = parseFilter(filter);

  try {
    if (explain) {
      const explainResult = await collection
        .find(queryFilter, {
          projection,
          limit: limit || 100,
        } as FindOptions<Document>)
        .explain(explain as string);

      return formatResponse(explainResult);
    }

    const cursor = collection.find(queryFilter, {
      projection,
      limit: limit || 100,
    } as FindOptions<Document>);
    const results = await cursor.toArray();

    return formatResponse(results);
  } catch (error) {
    return handleError(error, "query", collection.collectionName);
  }
}

async function handleAggregate(
  collection: Collection<Document> | null,
  args: Record<string, unknown>,
) {
  if (!collection) {
    throw new Error("Collection is required for aggregate operation");
  }
  const { pipeline, explain } = args;

  if (!Array.isArray(pipeline)) {
    throw new Error("Pipeline must be an array");
  }

  try {
    if (explain) {
      const explainResult = await collection
        .aggregate(pipeline, {
          explain: {
            verbosity: explain as string,
          },
        })
        .toArray();

      return formatResponse(explainResult);
    }

    const results = await collection.aggregate(pipeline).toArray();
    return formatResponse(results);
  } catch (error) {
    return handleError(error, "aggregate", collection.collectionName);
  }
}

async function handleUpdate(
  collection: Collection<Document> | null,
  args: Record<string, unknown>,
) {
  if (!collection) {
    throw new Error("Collection is required for update operation");
  }
  const { filter, update, upsert, multi } = args;
  const queryFilter = parseFilter(filter);

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
    const result = await collection[updateMethod](queryFilter, update, options);

    return formatResponse({
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId,
    });
  } catch (error) {
    return handleError(error, "update", collection.collectionName);
  }
}

async function handleServerInfo(
  db: Db,
  isReadOnlyMode: boolean,
  args: Record<string, unknown>,
) {
  const { includeDebugInfo } = args;

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
        readPreference: isReadOnlyMode ? "secondary" : "primary",
      },
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

    return formatResponse(serverInfo);
  } catch (error) {
    return handleError(error, "get server information");
  }
}

async function handleInsert(
  collection: Collection<Document> | null,
  args: Record<string, unknown>,
) {
  if (!collection) {
    throw new Error("Collection is required for insert operation");
  }
  const { documents, ordered, writeConcern, bypassDocumentValidation } = args;

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
    throw new Error("Each document must be a valid MongoDB document object");
  }

  try {
    // Type the options object correctly for BulkWriteOptions
    const options: BulkWriteOptions = {
      ordered: ordered !== false, // default to true if not specified
      writeConcern: writeConcern as WriteConcern,
      bypassDocumentValidation: bypassDocumentValidation as boolean,
    };

    // Use insertMany for consistency, it works for single documents too
    const result = await collection.insertMany(documents, options);

    return formatResponse({
      acknowledged: result.acknowledged,
      insertedCount: result.insertedCount,
      insertedIds: result.insertedIds,
    });
  } catch (error) {
    // Handle bulk write errors specially to provide more detail
    if (error instanceof Error && error.name === "BulkWriteError") {
      const bulkError = error as BulkWriteError;

      return formatResponse({
        error: "Bulk write error occurred",
        writeErrors: bulkError.writeErrors,
        insertedCount: bulkError.result?.nInserted || 0,
        failedCount: bulkError.result?.nFailedInserts || 0,
      });
    }

    return handleError(error, "insert", collection.collectionName);
  }
}

async function handleCreateIndex(
  collection: Collection<Document> | null,
  args: Record<string, unknown>,
) {
  if (!collection) {
    throw new Error("Collection is required for createIndex operation");
  }
  const { indexes, commitQuorum, writeConcern } = args;

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
    // Properly type createIndexes options
    const indexOptions: CreateIndexesOptions = {
      commitQuorum: typeof commitQuorum === "number" ? commitQuorum : undefined,
    };

    const result = await collection.createIndexes(indexes, indexOptions);

    // Type assertion for createIndexes result
    return formatResponse({
      acknowledged: (result as unknown as CreateIndexesResult).acknowledged,
      createdIndexes: (result as unknown as CreateIndexesResult).createdIndexes,
      numIndexesBefore: (result as unknown as CreateIndexesResult)
        .numIndexesBefore,
      numIndexesAfter: (result as unknown as CreateIndexesResult)
        .numIndexesAfter,
    });
  } catch (error) {
    return handleError(error, "create indexes", collection.collectionName);
  }
}

async function handleCount(
  collection: Collection<Document> | null,
  args: Record<string, unknown>,
) {
  if (!collection) {
    throw new Error("Collection is required for count operation");
  }
  const { query, limit, skip, hint, readConcern, maxTimeMS, collation } = args;
  const countQuery = parseFilter(query);

  try {
    // Build options object, removing undefined values
    const options: CountDocumentsOptions = {
      limit: typeof limit === "number" ? limit : undefined,
      skip: typeof skip === "number" ? skip : undefined,
      hint:
        typeof hint === "object" && hint !== null
          ? (hint as Document)
          : undefined,
      readConcern:
        typeof readConcern === "object" && readConcern !== null
          ? (readConcern as ReadConcernLike)
          : undefined,
      maxTimeMS: typeof maxTimeMS === "number" ? maxTimeMS : undefined,
      collation:
        typeof collation === "object" && collation !== null
          ? (collation as CollationOptions)
          : undefined,
    };

    // Remove undefined options
    for (const key of Object.keys(options)) {
      if (options[key as keyof CountDocumentsOptions] === undefined) {
        delete options[key as keyof CountDocumentsOptions];
      }
    }

    // Execute count operation
    const count = await collection.countDocuments(countQuery, options);

    return formatResponse({
      count,
      ok: 1,
    });
  } catch (error) {
    return handleError(error, "count documents", collection.collectionName);
  }
}

async function handleListCollections(db: Db, args: Record<string, unknown>) {
  const { nameOnly, filter } = args;

  try {
    // Get the list of collections
    const options = filter ? { filter } : {};
    const collections = await db.listCollections(options).toArray();

    // If nameOnly is true, return only the collection names
    const result = nameOnly
      ? collections.map((collection) => collection.name)
      : collections;

    return formatResponse(result);
  } catch (error) {
    return handleError(error, "list collections");
  }
}
