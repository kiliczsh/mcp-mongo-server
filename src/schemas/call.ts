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
} from "mongodb";

// Define interfaces for return types not properly exported by MongoDB
interface CreateIndexesResult {
  acknowledged: boolean;
  createdIndexes: string[];
  numIndexesBefore: number;
  numIndexesAfter: number;
}

// Define a more specific type for bulk write errors
interface BulkWriteError extends Error {
  name: string;
  writeErrors?: Array<any>; // TODO: Fix Typescript error
  result?: {
    nInserted?: number;
    nFailedInserts?: number;
  };
}

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
  // Add explicit type assertion for collection name
  const collection = db.collection(
    request.params.arguments?.collection as string,
  );

  // Define write operations that should be blocked in read-only mode
  const writeOperations = ["update", "insert", "createIndex"];

  // Check if the operation is a write operation and we're in read-only mode
  if (isReadOnlyMode && writeOperations.includes(request.params.name)) {
    throw new Error(
      `ReadonlyError: Operation '${request.params.name}' is not allowed in read-only mode`,
    );
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
          // Type assertions for find parameters
          const explainResult = await collection
            .find(
              queryFilter as Filter<Document>,
              {
                projection,
                limit: limit || 100,
              } as FindOptions<Document>,
            )
            .explain(explain as string);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(explainResult, null, 2),
              },
            ],
          };
        }

        // Regular find execution (removed unnecessary else clause)
        const cursor = collection.find(
          queryFilter as Filter<Document>,
          {
            projection,
            limit: limit || 100,
          } as FindOptions<Document>,
        );
        const results = await cursor.toArray();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
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
          // Type assertion for explain verbosity
          const explainResult = await collection
            .aggregate(pipeline, {
              explain: {
                verbosity: explain as string,
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
        }

        // Regular aggregation execution (removed unnecessary else clause)
        const results = await collection.aggregate(pipeline).toArray();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
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
          queryFilter as Filter<Document>,
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
        // Type the options object correctly for BulkWriteOptions
        const options: BulkWriteOptions = {
          ordered: ordered !== false, // default to true if not specified
          writeConcern: writeConcern as WriteConcern,
          bypassDocumentValidation: bypassDocumentValidation as boolean,
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
            const bulkError = error as BulkWriteError;
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
      const { indexes, commitQuorum } = request.params.arguments || {};

      // Validate collection name to prevent access to system collections
      if (collection.collectionName.startsWith("system.")) {
        throw new Error("Access to system collections is not allowed");
      }

      // Validate indexes array
      if (!Array.isArray(indexes) || indexes.length === 0) {
        throw new Error("Indexes must be a non-empty array");
      }

      // Remove writeConcern from options
      const { writeConcern } = request.params.arguments || {};

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
          commitQuorum:
            typeof commitQuorum === "number" ? commitQuorum : undefined,
        };

        const result = await collection.createIndexes(indexes, indexOptions);

        // Type assertion for createIndexes result
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  acknowledged: (result as unknown as CreateIndexesResult)
                    .acknowledged,
                  createdIndexes: (result as unknown as CreateIndexesResult)
                    .createdIndexes,
                  numIndexesBefore: (result as unknown as CreateIndexesResult)
                    .numIndexesBefore,
                  numIndexesAfter: (result as unknown as CreateIndexesResult)
                    .numIndexesAfter,
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
        // Properly type count options
        const options: CountDocumentsOptions = {
          limit: typeof args.limit === "number" ? args.limit : undefined,
          skip: typeof args.skip === "number" ? args.skip : undefined,
          hint:
            typeof args.hint === "object" && args.hint !== null
              ? (args.hint as Document)
              : undefined,
          readConcern:
            typeof args.readConcern === "object" && args.readConcern !== null
              ? (args.readConcern as ReadConcernLike)
              : undefined,
          maxTimeMS:
            typeof args.maxTimeMS === "number" ? args.maxTimeMS : undefined,
          collation:
            typeof args.collation === "object" && args.collation !== null
              ? (args.collation as CollationOptions)
              : undefined,
        };

        // Remove undefined options using for...of instead of forEach
        for (const key of Object.keys(options)) {
          if (options[key as keyof CountDocumentsOptions] === undefined) {
            delete options[key as keyof CountDocumentsOptions];
          }
        }

        // Execute count operation
        const count = await collection.countDocuments(
          countQuery as Filter<Document>,
          options as CountDocumentsOptions,
        );

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
          ? collections.map((collection) => collection.name)
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
}
