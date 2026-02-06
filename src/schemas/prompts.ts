import type {
  GetPromptRequest,
  ListPromptsRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { Db, MongoClient } from "mongodb";

export async function handleListPromptsRequest({
  request,
  client,
  db,
  isReadOnlyMode,
  signal,
}: {
  request: ListPromptsRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
  signal?: AbortSignal;
}) {
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
}

export async function handleGetPromptRequest({
  request,
  client,
  db,
  isReadOnlyMode,
  signal,
}: {
  request: GetPromptRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
  signal?: AbortSignal;
}) {
  const { name, arguments: args = {} } = request.params;

  if (name !== "analyze_collection") {
    throw new Error("Unknown prompt");
  }

  const collectionName = args.collection;
  if (!collectionName) {
    throw new Error("Collection name is required");
  }

  try {
    const collection = db.collection(collectionName);

    if (collection.collectionName.startsWith("system.")) {
      throw new Error("Access to system collections is not allowed");
    }

    signal?.throwIfAborted();
    const schemaSample = await collection.findOne({});
    signal?.throwIfAborted();
    const stats = await collection
      .aggregate([{ $collStats: { count: {} } }])
      .toArray();
    signal?.throwIfAborted();
    const sampleDocs = await collection.find({}).limit(5).toArray();

    const documentCount = stats[0]?.count ?? "unknown";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please analyze the following MongoDB collection:
Collection: ${collectionName}

Schema:
${JSON.stringify(schemaSample, null, 2)}

Stats:
Document count: ${documentCount}

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
    const msg = error instanceof Error ? error.message : "Unknown error";

    throw new Error(`Failed to analyze collection ${collectionName}: ${msg}`);
  }
}
