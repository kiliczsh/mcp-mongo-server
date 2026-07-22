import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type {
  CallToolRequest,
  CallToolResult,
} from "@modelcontextprotocol/server";
import type {
  BulkWriteOptions,
  CollationOptions,
  Collection,
  CountDocumentsOptions,
  CreateIndexesOptions,
  Db,
  Document,
  Filter,
  FindOptions,
  MongoClient,
  ReadConcernLike,
  WriteConcern,
} from "mongodb";
import { ObjectId } from "mongodb";

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

// Maximum object nesting depth we will walk when converting ObjectId/date
// strings. Matches MongoDB's own BSON nesting limit, so we reject the same
// inputs it would — but with a clear error and without risking a stack
// overflow on pathologically deep input.
const MAX_OBJECT_DEPTH = 100;

// Aggregation write stages ($out, $merge) can create or replace collections.
const WRITE_AGG_STAGES = new Set(["$out", "$merge"]);

// Server-side JavaScript operators allow arbitrary code execution on the
// MongoDB server (and are a denial-of-service vector via infinite loops).
const SERVER_JS_AGG_OPERATORS = new Set([
  "$function",
  "$accumulator",
  "$where",
]);

// Everything blocked in read-only mode: no writes and no server-side JS.
const READONLY_FORBIDDEN_AGG_OPERATORS = new Set([
  ...WRITE_AGG_STAGES,
  ...SERVER_JS_AGG_OPERATORS,
]);

/**
 * Recursively scan an aggregation pipeline for any operator in `operators`
 * (matched case-sensitively as object keys). Returns the first match, or null.
 * Guards against overly deep nesting so a pathological pipeline can't overflow
 * the stack before the operator/depth checks run.
 */
function findAggOperator(
  value: unknown,
  operators: Set<string>,
  depth = 0,
): string | null {
  if (depth > MAX_OBJECT_DEPTH) {
    throw new Error(
      `Object nesting exceeds the maximum depth of ${MAX_OBJECT_DEPTH}`,
    );
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAggOperator(item, operators, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (operators.has(key)) {
        return key;
      }
      const found = findAggOperator(nested, operators, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Scan an aggregation pipeline for stages that read from or write to a database
 * other than the connected one ($out, $merge, $lookup with an explicit `db`).
 * Returns the first foreign database name found, or null. Used to keep the
 * server scoped to its connected database unless cross-database access is
 * explicitly enabled.
 */
function findCrossDbTarget(
  pipeline: unknown[],
  connectedDb: string,
): string | null {
  const foreignDb = (target: unknown): string | null => {
    if (target && typeof target === "object" && "db" in target) {
      const db = (target as { db?: unknown }).db;
      if (typeof db === "string" && db && db !== connectedDb) return db;
    }
    return null;
  };

  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object") continue;
    const s = stage as Record<string, unknown>;
    // $out: "<db>.<coll>" is same-db; { db, coll } may target another db
    const out = foreignDb(s.$out);
    if (out) return out;
    // $merge: { into: "<coll>" | { db, coll } }
    const merge = s.$merge as { into?: unknown } | undefined;
    const mergeInto = foreignDb(merge?.into ?? s.$merge);
    if (mergeInto) return mergeInto;
    // $lookup: { from: { db, coll } } (cross-db read)
    const lookup = s.$lookup as { from?: unknown } | undefined;
    const lookupFrom = foreignDb(lookup?.from);
    if (lookupFrom) return lookupFrom;
  }

  return null;
}

// ObjectId conversion settings
type ObjectIdConversionMode = "auto" | "none" | "force";

export async function handleCallToolRequest({
  request,
  client,
  db,
  isReadOnlyMode,
  allowCrossDb = false,
  allowServerJs = false,
  signal,
}: {
  request: CallToolRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
  allowCrossDb?: boolean;
  allowServerJs?: boolean;
  signal?: AbortSignal;
}) {
  const { name, arguments: args = {} } = request.params;
  const operation = name as MongoOperation;

  // Extract ObjectId conversion mode from args (default to 'auto')
  const objectIdMode = (args.objectIdMode as ObjectIdConversionMode) || "auto";

  // Create new args object without objectIdMode property
  const filteredArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key !== "objectIdMode") {
      filteredArgs[key] = value;
    }
  }

  // Checking whether sort option provided is valid
  if (args.sort) {
    args.sort = parseSort(args.sort);
  }

  // Replace the original args with the filtered version
  Object.assign(args, filteredArgs);

  // Validate operation name. An unknown tool name is a protocol error
  // (InvalidParams); everything past this point reports failures as tool
  // execution errors so the model can see and correct them (SEP-1303).
  validateOperation(operation);

  try {
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

    signal?.throwIfAborted();

    return await executeOperation(
      operation,
      collection,
      db,
      isReadOnlyMode,
      allowCrossDb,
      allowServerJs,
      args,
      objectIdMode,
      signal,
    );
  } catch (error) {
    // Protocol-level errors and cancellation propagate unchanged
    if (error instanceof ProtocolError || signal?.aborted) {
      throw error;
    }
    return toolExecutionError(
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

async function executeOperation(
  operation: MongoOperation,
  collection: Collection<Document> | null,
  db: Db,
  isReadOnlyMode: boolean,
  allowCrossDb: boolean,
  allowServerJs: boolean,
  args: Record<string, unknown>,
  objectIdMode: ObjectIdConversionMode,
  signal?: AbortSignal,
) {
  switch (operation) {
    case "query":
      return handleQuery(collection, args, objectIdMode, signal);
    case "aggregate":
      return handleAggregate(
        collection,
        args,
        objectIdMode,
        isReadOnlyMode,
        allowCrossDb,
        allowServerJs,
        signal,
      );
    case "update":
      return handleUpdate(collection, args, objectIdMode, signal);
    case "serverInfo":
      return handleServerInfo(db, isReadOnlyMode, args, signal);
    case "insert":
      return handleInsert(collection, args, objectIdMode, signal);
    case "createIndex":
      return handleCreateIndex(collection, args, objectIdMode, signal);
    case "count":
      return handleCount(collection, args, objectIdMode, signal);
    case "listCollections":
      return handleListCollections(db, args, objectIdMode, signal);
    default:
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${operation}`);
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
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${operation}`);
  }
}

function validateCollection(collection: Collection<Document>): void {
  if (!collection.collectionName) {
    throw new Error("Collection name cannot be empty");
  }
  // Case-insensitive so 'System.' and other casings can't slip past the guard.
  if (collection.collectionName.toLowerCase().startsWith("system.")) {
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

function parseSort(sort: unknown): Record<string, 1 | -1> | null {
  if (!sort) return null;

  if (typeof sort !== "object" || sort === null || Array.isArray(sort)) {
    return null;
  }

  const validSort: Record<string, 1 | -1> = {};

  for (const [key, value] of Object.entries(sort)) {
    if (typeof value === "number" && (value === 1 || value === -1)) {
      validSort[key] = value;
    }
  }

  return Object.keys(validSort).length > 0 ? validSort : null;
}

function parseFilter(
  filter: unknown,
  objectIdMode: ObjectIdConversionMode = "auto",
): Filter<Document> {
  if (!filter) {
    return {};
  }

  if (typeof filter === "string") {
    try {
      return processObjectIdInFilter(JSON.parse(filter), objectIdMode);
    } catch {
      throw new Error("Invalid filter format: must be a valid JSON object");
    }
  }

  if (typeof filter === "object" && filter !== null && !Array.isArray(filter)) {
    // Process the filter to convert potential ObjectId strings
    return processObjectIdInFilter(
      filter as Record<string, unknown>,
      objectIdMode,
    );
  }

  throw new Error("Query filter must be a plain object or ObjectId");
}

// Helper function to check if a field should be treated as an ObjectId based on its name
function isObjectIdField(fieldName: string): boolean {
  // Convert field name to lowercase for case-insensitive comparison
  const lowerFieldName = fieldName.toLowerCase();

  // Consider fields like _id, id, xxxId, xxx_id as potential ObjectId fields
  return (
    lowerFieldName === "_id" ||
    lowerFieldName === "id" ||
    lowerFieldName.endsWith("id") ||
    lowerFieldName.endsWith("_id")
  );
}

// Helper function to process potential ObjectId strings in filters
function processObjectIdInFilter(
  filter: Record<string, unknown>,
  objectIdMode: ObjectIdConversionMode = "auto",
  depth = 0,
): Filter<Document> {
  if (depth > MAX_OBJECT_DEPTH) {
    throw new Error(
      `Object nesting exceeds the maximum depth of ${MAX_OBJECT_DEPTH}`,
    );
  }

  // If objectIdMode is "none", don't convert any strings to ObjectIds
  if (objectIdMode === "none") {
    // Create a new filter object to handle dates
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(filter)) {
      if (typeof value === "string" && isISODateString(value)) {
        // Convert ISO date string to Date object
        result[key] = new Date(value);
      } else if (
        typeof value === "string" &&
        value.startsWith("ISODate(") &&
        value.endsWith(")")
      ) {
        // Handle ISODate("2025-01-01T00:00:00Z") format
        const dateString = value.substring(8, value.length - 2);
        if (isISODateString(dateString)) {
          result[key] = new Date(dateString);
        } else {
          result[key] = value;
        }
      } else if (typeof value === "object" && value !== null) {
        if (Array.isArray(value)) {
          // For arrays, apply date conversion to each item
          result[key] = value.map((item) => {
            if (typeof item === "string" && isISODateString(item)) {
              return new Date(item);
            } else if (
              typeof item === "string" &&
              item.startsWith("ISODate(") &&
              item.endsWith(")")
            ) {
              const dateString = item.substring(8, item.length - 2);
              return isISODateString(dateString) ? new Date(dateString) : item;
            }
            return item;
          });
        } else {
          // Process nested objects
          result[key] = processObjectIdInFilter(
            value as Record<string, unknown>,
            "none",
            depth + 1,
          );
        }
      } else {
        result[key] = value;
      }
    }
    return result as Filter<Document>;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filter)) {
    if (typeof value === "string" && isObjectIdString(value)) {
      // Convert string to ObjectId if either:
      // 1. objectIdMode is "force" (convert all 24-char hex strings)
      // 2. objectIdMode is "auto" AND the field name suggests it's an ObjectId
      if (
        objectIdMode === "force" ||
        (objectIdMode === "auto" && isObjectIdField(key))
      ) {
        result[key] = new ObjectId(value);
      } else {
        result[key] = value;
      }
    } else if (typeof value === "string" && isISODateString(value)) {
      // Convert ISO date string to Date object
      result[key] = new Date(value);
    } else if (
      typeof value === "string" &&
      value.startsWith("ISODate(") &&
      value.endsWith(")")
    ) {
      // Handle ISODate("2025-01-01T00:00:00Z") format
      const dateString = value.substring(8, value.length - 2);
      if (isISODateString(dateString)) {
        result[key] = new Date(dateString);
      } else {
        result[key] = value;
      }
    } else if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        // For arrays, apply the same logic to each item
        result[key] = value.map((item) => {
          if (
            typeof item === "string" &&
            isObjectIdString(item) &&
            (objectIdMode === "force" ||
              (objectIdMode === "auto" && isObjectIdField(key)))
          ) {
            return new ObjectId(item);
          } else if (typeof item === "string" && isISODateString(item)) {
            return new Date(item);
          } else if (
            typeof item === "string" &&
            item.startsWith("ISODate(") &&
            item.endsWith(")")
          ) {
            const dateString = item.substring(8, item.length - 2);
            return isISODateString(dateString) ? new Date(dateString) : item;
          }
          return item;
        });
      } else {
        // Process nested objects
        result[key] = processObjectIdInFilter(
          value as Record<string, unknown>,
          objectIdMode,
          depth + 1,
        );
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Helper function to check if a string appears to be an ObjectId
function isObjectIdString(str: string): boolean {
  // MongoDB ObjectId is typically a 24-character hex string
  return /^[0-9a-fA-F]{24}$/.test(str);
}

// Helper function to check if a string is in ISO date format
function isISODateString(str: string): boolean {
  // Check if string matches ISO 8601 format
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(str);
}

function formatResponse(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toolExecutionError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function handleError(
  error: unknown,
  operation: string,
  collectionName?: string,
): ReturnType<typeof toolExecutionError> {
  // Cancellation is not a tool failure — let it propagate to the protocol layer
  if (error instanceof Error && error.name === "AbortError") {
    throw error;
  }

  const context = collectionName ? `collection ${collectionName}` : "operation";
  const message = error instanceof Error ? error.message : "Unknown error";

  return toolExecutionError(`Failed to ${operation} ${context}: ${message}`);
}

// Operation handlers

async function handleQuery(
  collection: Collection<Document> | null,
  args: Record<string, unknown>,
  objectIdMode: ObjectIdConversionMode = "auto",
  signal?: AbortSignal,
) {
  if (!collection) {
    throw new Error("Collection is required for query operation");
  }
  const { filter, projection, explain, sort } = args;
  const limit = (args.limit as number) || 10;
  const skip = (args.skip as number) || 0;
  const queryFilter = parseFilter(filter, objectIdMode);
  try {
    if (explain) {
      signal?.throwIfAborted();
      const explainResult = await collection
        .find(queryFilter, {
          projection,
          limit,
          skip,
          sort,
        } as FindOptions)
        .explain(explain as string);

      return formatResponse(explainResult);
    }

    signal?.throwIfAborted();
    const [total, results] = await Promise.all([
      collection.countDocuments(queryFilter),
      collection
        .find(queryFilter, {
          projection,
          limit,
          skip,
          sort,
        } as FindOptions)
        .toArray(),
    ]);

    return formatResponse({
      results,
      metadata: {
        total,
        returned: results.length,
        skip,
        limit,
        hasMore: skip + results.length < total,
      },
    });
  } catch (error) {
    return handleError(error, "query", collection.collectionName);
  }
}

async function handleAggregate(
  collection: Collection<Document> | null,
  args: Record<string, unknown>,
  objectIdMode: ObjectIdConversionMode = "auto",
  isReadOnlyMode = false,
  allowCrossDb = false,
  allowServerJs = false,
  signal?: AbortSignal,
) {
  if (!collection) {
    throw new Error("Collection is required for aggregate operation");
  }
  const { pipeline, explain } = args;

  if (!Array.isArray(pipeline)) {
    throw new Error("Pipeline must be an array");
  }

  // In read-only mode, reject pipelines that could write to the database or
  // execute server-side JavaScript. Without this an aggregate ending in $out
  // or $merge would bypass read-only protection and overwrite collections.
  if (isReadOnlyMode) {
    const forbidden = findAggOperator(
      pipeline,
      READONLY_FORBIDDEN_AGG_OPERATORS,
    );
    if (forbidden) {
      throw new Error(
        `ReadonlyError: Aggregation operator '${forbidden}' is not allowed in read-only mode`,
      );
    }
  }

  // Server-side JavaScript ($function/$where/$accumulator) is arbitrary code
  // execution on the MongoDB server; reject it by default even outside
  // read-only mode, unless explicitly enabled.
  if (!allowServerJs) {
    const js = findAggOperator(pipeline, SERVER_JS_AGG_OPERATORS);
    if (js) {
      throw new Error(
        `Server-side JavaScript operator '${js}' is not allowed. Enable it with --allow-server-js or MCP_MONGODB_ALLOW_SERVER_JS=true.`,
      );
    }
  }

  // Keep the server scoped to its connected database: reject $out/$merge/$lookup
  // that target another database, unless cross-database access is enabled.
  if (!allowCrossDb) {
    const foreignDb = findCrossDbTarget(pipeline, collection.dbName);
    if (foreignDb) {
      throw new Error(
        `Cross-database access to '${foreignDb}' is not allowed (connected database is '${collection.dbName}'). Enable it with --allow-cross-db or MCP_MONGODB_ALLOW_CROSS_DB=true.`,
      );
    }
  }

  // Process any ObjectId strings in the pipeline
  const processedPipeline = pipeline.map((stage) => {
    if (typeof stage === "object" && stage !== null) {
      return processObjectIdInFilter(
        stage as Record<string, unknown>,
        objectIdMode,
      );
    }
    return stage;
  });

  try {
    if (explain) {
      signal?.throwIfAborted();
      const explainResult = await collection
        .aggregate(processedPipeline, {
          explain: {
            verbosity: explain as string,
          },
        })
        .toArray();

      return formatResponse(explainResult);
    }

    signal?.throwIfAborted();
    const results = await collection.aggregate(processedPipeline).toArray();
    return formatResponse({
      results,
      metadata: {
        returned: results.length,
      },
    });
  } catch (error) {
    return handleError(error, "aggregate", collection.collectionName);
  }
}

async function handleUpdate(
  collection: Collection<Document> | null,
  args: Record<string, unknown>,
  objectIdMode: ObjectIdConversionMode = "auto",
  signal?: AbortSignal,
) {
  if (!collection) {
    throw new Error("Collection is required for update operation");
  }
  const { filter, update, upsert, multi } = args;
  const queryFilter = parseFilter(filter, objectIdMode);

  // Process update object for potential ObjectId strings
  let processedUpdate = update;
  if (update && typeof update === "object" && !Array.isArray(update)) {
    processedUpdate = processObjectIdInFilter(
      update as Record<string, unknown>,
      objectIdMode,
    );
  }

  // Validate update operations
  if (
    !processedUpdate ||
    typeof processedUpdate !== "object" ||
    Array.isArray(processedUpdate)
  ) {
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

  const hasValidOperator = Object.keys(processedUpdate).some((key) =>
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
    signal?.throwIfAborted();
    const result = await collection[updateMethod](
      queryFilter,
      processedUpdate,
      options,
    );

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
  signal?: AbortSignal,
) {
  const { includeDebugInfo } = args;

  try {
    // Get basic server information using buildInfo command
    signal?.throwIfAborted();
    const buildInfo = await db.command({ buildInfo: 1 });

    // Lean response by default; verbose build/runtime details (compiler
    // flags, server status) are large and only returned on explicit request
    const serverInfo: Record<string, unknown> = {
      version: buildInfo.version,
      gitVersion: buildInfo.gitVersion,
      storageEngines: buildInfo.storageEngines,
      maxBsonObjectSize: buildInfo.maxBsonObjectSize,
      bits: buildInfo.bits,
      ok: buildInfo.ok,
      connectionInfo: {
        readOnlyMode: isReadOnlyMode,
      },
    };

    if (includeDebugInfo) {
      signal?.throwIfAborted();
      const serverStatus = await db.command({ serverStatus: 1 });

      serverInfo.modules = buildInfo.modules;
      serverInfo.allocator = buildInfo.allocator;
      serverInfo.javascriptEngine = buildInfo.javascriptEngine;
      serverInfo.sysInfo = buildInfo.sysInfo;
      serverInfo.debug = buildInfo.debug;
      serverInfo.openssl = buildInfo.openssl;
      serverInfo.buildEnvironment = buildInfo.buildEnvironment;
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
  objectIdMode: ObjectIdConversionMode = "auto",
  signal?: AbortSignal,
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

  // Process ObjectId strings in documents
  const processedDocuments = documents.map((doc) =>
    processObjectIdInFilter(doc as Record<string, unknown>, objectIdMode),
  );

  try {
    // Type the options object correctly for BulkWriteOptions
    const options: BulkWriteOptions = {
      ordered: ordered !== false, // default to true if not specified
      writeConcern: writeConcern as WriteConcern,
      bypassDocumentValidation: bypassDocumentValidation as boolean,
    };

    // Use insertMany for consistency, it works for single documents too
    signal?.throwIfAborted();
    const result = await collection.insertMany(
      processedDocuments as Document[],
      options,
    );

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
  objectIdMode: ObjectIdConversionMode = "auto",
  signal?: AbortSignal,
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

  // Process ObjectId strings in indexes
  const processedIndexes = indexes.map((index) => {
    if (index && typeof index === "object") {
      return processObjectIdInFilter(
        index as Record<string, unknown>,
        objectIdMode,
      );
    }
    return index;
  });

  try {
    // Properly type createIndexes options
    const indexOptions: CreateIndexesOptions = {
      commitQuorum: typeof commitQuorum === "number" ? commitQuorum : undefined,
    };

    signal?.throwIfAborted();
    const result = await collection.createIndexes(
      processedIndexes,
      indexOptions,
    );

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
  objectIdMode: ObjectIdConversionMode = "auto",
  signal?: AbortSignal,
) {
  if (!collection) {
    throw new Error("Collection is required for count operation");
  }
  const { query, limit, skip, hint, readConcern, maxTimeMS, collation } = args;
  const countQuery = parseFilter(query, objectIdMode);

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
    signal?.throwIfAborted();
    const count = await collection.countDocuments(countQuery, options);

    return formatResponse({
      count,
      ok: 1,
    });
  } catch (error) {
    return handleError(error, "count documents", collection.collectionName);
  }
}

async function handleListCollections(
  db: Db,
  args: Record<string, unknown>,
  objectIdMode: ObjectIdConversionMode = "auto",
  signal?: AbortSignal,
) {
  const { nameOnly, filter } = args;
  const skip = (args.skip as number) || 0;
  const limit = (args.limit as number) || 20;

  // Process ObjectId strings in filter if present
  let processedFilter = filter;
  if (filter && typeof filter === "object") {
    processedFilter = processObjectIdInFilter(
      filter as Record<string, unknown>,
      objectIdMode,
    );
  }

  try {
    // Get the list of collections
    const options = processedFilter ? { filter: processedFilter } : {};
    signal?.throwIfAborted();
    const collections = await db.listCollections(options).toArray();

    // If nameOnly is true, return only the collection names
    const allResults = nameOnly
      ? collections.map((collection) => collection.name)
      : collections;

    const total = allResults.length;
    const paged = allResults.slice(skip, skip + limit);

    return formatResponse({
      results: paged,
      metadata: {
        total,
        returned: paged.length,
        skip,
        limit,
        hasMore: skip + paged.length < total,
      },
    });
  } catch (error) {
    return handleError(error, "list collections");
  }
}
