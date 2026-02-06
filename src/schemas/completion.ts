import type {
  CompleteRequest,
  CompleteResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { CollectionInfo, Db, MongoClient } from "mongodb";
import { paginate } from "../utils/pagination.js";

/**
 * Handles completion requests from the Model Context Protocol
 * @param options The request options
 * @returns Completion result with matching values
 */
export async function handleCompletionRequest({
  request,
  client,
  db,
  isReadOnlyMode,
}: {
  request: CompleteRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
}): Promise<CompleteResult> {
  const { ref, argument } = request.params;

  // Handle completions for prompts
  if (ref.type === "ref/prompt") {
    return handlePromptCompletion(
      client,
      db,
      isReadOnlyMode,
      ref.name,
      argument,
    );
  }

  // Handle completions for resources
  if (ref.type === "ref/resource") {
    return handleResourceCompletion(
      client,
      db,
      isReadOnlyMode,
      ref.uri,
      argument,
    );
  }

  // Default empty response if reference type is not supported
  return emptyCompletionResult();
}

/**
 * Handle completion requests for prompts
 * @param client MongoDB client
 * @param db MongoDB database
 * @param isReadOnlyMode Whether the database is in read-only mode
 * @param promptName Name of the prompt
 * @param argument Argument being completed
 * @returns Completion result
 */
async function handlePromptCompletion(
  client: MongoClient,
  db: Db,
  isReadOnlyMode: boolean,
  promptName: string | undefined,
  argument: { name: string; value: string },
): Promise<CompleteResult> {
  if (!promptName) {
    return emptyCompletionResult();
  }

  // Handle collection name completions
  if (argument.name === "collection") {
    return await completeCollectionNames(argument.value, db, isReadOnlyMode);
  }

  // Add other prompt completions here as needed

  return emptyCompletionResult();
}

/**
 * Handle completion requests for resources
 * @param client MongoDB client
 * @param db MongoDB database
 * @param isReadOnlyMode Whether the database is in read-only mode
 * @param uri Resource URI
 * @param argument Argument being completed
 * @returns Completion result
 */
async function handleResourceCompletion(
  client: MongoClient,
  db: Db,
  isReadOnlyMode: boolean,
  promptName: string | undefined,
  argument: { name: string; value: string },
): Promise<CompleteResult> {
  if (!promptName) {
    return emptyCompletionResult();
  }

  // Handle collection name completions
  if (argument.name === "collection") {
    return await completeCollectionNames(argument.value, db, isReadOnlyMode);
  }

  // Add other prompt completions here as needed

  return emptyCompletionResult();
}

/**
 * Get collection name completions for a partial value
 * @param partialValue Partial collection name
 * @param db MongoDB database
 * @param isReadOnlyMode Whether the database is in read-only mode
 * @returns Completion result with matching collection names
 */
async function completeCollectionNames(
  partialValue: string,
  db: Db,
  isReadOnlyMode: boolean,
): Promise<CompleteResult> {
  try {
    console.warn(
      `Completing collection names with partial value: ${partialValue}`,
    );

    // Get list of collections
    const collections: (
      | CollectionInfo
      | Pick<CollectionInfo, "type" | "name">
    )[] = await db.listCollections().toArray();

    // Filter collections by partial value (case insensitive)
    const matchingCollections = collections
      .map(
        (c: CollectionInfo | Pick<CollectionInfo, "type" | "name">) => c.name,
      )
      .filter(
        (name: string) =>
          // Filter out system collections
          !name.startsWith("system.") &&
          // Match partial value
          name.toLowerCase().includes(partialValue.toLowerCase()),
      )
      // Sort alphabetically
      .sort();

    console.warn(`Found ${matchingCollections.length} matching collections`);

    // Paginate results using cursor-based pagination (page size 100 per spec)
    const PAGE_SIZE = 100;
    const { items: limitedResults, nextCursor } = paginate(
      matchingCollections,
      undefined,
      PAGE_SIZE,
    );

    return {
      completion: {
        values: limitedResults,
        total: matchingCollections.length,
        hasMore: !!nextCursor,
      },
    };
  } catch (error) {
    console.error("Error completing collection names:", error);

    // Return empty result on error
    return emptyCompletionResult();
  }
}

/**
 * Create an empty completion result
 * @returns Empty completion result object
 */
function emptyCompletionResult(): CompleteResult {
  return {
    completion: {
      values: [],
      total: 0,
      hasMore: false,
    },
  };
}
