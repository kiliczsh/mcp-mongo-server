import type {
  ListResourcesRequest,
  ReadResourceRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CollectionInfo,
  Db,
  IndexDescriptionInfo,
  MongoClient,
} from "mongodb";

export async function handleReadResourceRequest({
  request,
  client,
  db,
  isReadOnlyMode,
}: {
  request: ReadResourceRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
}) {
  const url = new URL(request.params.uri);
  const collectionName = url.pathname.replace(/^\//, "");

  try {
    const collection = db.collection(collectionName);
    const sample = await collection.findOne({});
    const indexes = await collection.indexes();

    const schema = sample
      ? {
          type: "collection",
          name: collectionName,
          fields: Object.entries(sample).map(([key, value]) => ({
            name: key,
            type: typeof value,
          })),
          indexes: indexes.map((idx: IndexDescriptionInfo) => ({
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
}

export async function handleListResourcesRequest({
  request,
  client,
  db,
  isReadOnlyMode,
}: {
  request: ListResourcesRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
}) {
  try {
    const collections = await db.listCollections().toArray();

    return {
      resources: collections.map((collection: CollectionInfo) => ({
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
}
