import type {
  ListResourcesRequest,
  ReadResourceRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CollectionInfo,
  Db,
  Document,
  IndexDescriptionInfo,
  MongoClient,
} from "mongodb";
import { ObjectId } from "mongodb";
import { paginate } from "../utils/pagination.js";

// Define interfaces for schema inference
interface FieldInfo {
  name: string;
  types: Set<string>;
  nullable: boolean;
  samples: unknown[];
  nestedSchema?: SchemaResult;
}

interface SchemaResult {
  fields: FieldSummary[];
}

interface FieldSummary {
  name: string;
  types: string[];
  nullable: boolean;
  prevalence: string;
  examples: unknown[];
  nestedSchema?: SchemaResult;
}

interface CollectionSchema {
  type: string;
  name: string;
  fields: FieldSummary[];
  indexes: Array<{
    name: string | undefined;
    keys: Record<string, unknown>;
  }>;
  documentCount: number | string | null;
  sampleSize: number;
  lastUpdated: string;
}

/**
 * Detects the MongoDB-specific type of a value
 * @param value The value to detect the type of
 * @returns A string representing the detected type
 */
function detectMongoType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (value instanceof ObjectId) return "ObjectId";
  if (value instanceof Date) return "Date";
  if (Array.isArray(value)) {
    if (value.length === 0) return "Array";

    // Check if array has consistent types
    const elementTypes = new Set(value.map((item) => detectMongoType(item)));
    if (elementTypes.size === 1) {
      return `Array<${Array.from(elementTypes)[0]}>`;
    }
    return "Array<mixed>";
  }

  if (typeof value === "object") {
    // Handle nested documents
    return "Document";
  }

  return typeof value;
}

/**
 * Helper function to infer a schema from multiple documents
 * @param documents Array of sample documents from the collection
 * @returns Inferred schema with field names and types
 */
function inferSchemaFromSamples(documents: Document[]): SchemaResult {
  if (!documents || documents.length === 0) {
    return { fields: [] };
  }

  // Use a Map to store field information, with the key being the field name
  const fieldMap = new Map<string, FieldInfo>();

  // Process each document to collect field information
  for (const doc of documents) {
    for (const [key, value] of Object.entries(doc)) {
      if (!fieldMap.has(key)) {
        // Initialize field info if we haven't seen this field before
        fieldMap.set(key, {
          name: key,
          types: new Set([detectMongoType(value)]),
          nullable: false,
          // Store sample values for complex types
          samples: [value],
        });
      } else {
        // Update existing field info
        const fieldInfo = fieldMap.get(key)!;
        fieldInfo.types.add(detectMongoType(value));

        // Store up to 3 different sample values
        if (
          fieldInfo.samples.length < 3 &&
          !fieldInfo.samples.some(
            (sample: unknown) =>
              JSON.stringify(sample) === JSON.stringify(value),
          )
        ) {
          fieldInfo.samples.push(value);
        }
      }
    }
  }

  // Check for nullable fields by seeing which fields are missing in some documents
  for (const doc of documents) {
    for (const [key] of fieldMap.entries()) {
      if (!(key in doc)) {
        const fieldInfo = fieldMap.get(key)!;
        fieldInfo.nullable = true;
      }
    }
  }

  // Process nested document schemas
  for (const [key, fieldInfo] of fieldMap.entries()) {
    if (fieldInfo.types.has("Document")) {
      // Extract nested documents for this field
      const nestedDocs = documents
        .filter(
          (doc) =>
            doc[key] &&
            typeof doc[key] === "object" &&
            !Array.isArray(doc[key]),
        )
        .map((doc) => doc[key] as Document);

      if (nestedDocs.length > 0) {
        // Recursively infer schema for nested documents
        fieldInfo.nestedSchema = inferSchemaFromSamples(nestedDocs);
      }
    }
  }

  // Convert the Map to an array of field objects with additional info
  const fields = Array.from(fieldMap.values()).map((fieldInfo) => {
    const result: FieldSummary = {
      name: fieldInfo.name,
      types: Array.from(fieldInfo.types),
      nullable: fieldInfo.nullable,
      prevalence: `${Math.round(
        (documents.filter((doc) => fieldInfo.name in doc).length /
          documents.length) *
          100,
      )}%`,
      examples: [],
    };

    // Include nested schema if available
    if (fieldInfo.nestedSchema) {
      result.nestedSchema = fieldInfo.nestedSchema;
    }

    // Include simplified sample values
    const sampleValues = fieldInfo.samples.map((sample: unknown) => {
      if (sample instanceof ObjectId) return sample.toString();
      if (sample instanceof Date) return sample.toISOString();
      if (typeof sample === "object") {
        // For objects/arrays, just indicate type rather than full structure
        return Array.isArray(sample) ? "[...]" : "{...}";
      }
      return sample;
    });

    result.examples = sampleValues;

    return result;
  });

  return { fields };
}

export async function handleReadResourceRequest({
  request,
  client,
  db,
  isReadOnlyMode,
  signal,
}: {
  request: ReadResourceRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
  signal?: AbortSignal;
}) {
  const url = new URL(request.params.uri);
  const collectionName = url.pathname.replace(/^\//, "");

  try {
    const collection = db.collection(collectionName);

    // Set sample size for schema inference
    const sampleSize = 100;
    let sampleDocuments: Document[] = [];

    try {
      // First try using MongoDB's $sample aggregation to get a diverse set of documents
      signal?.throwIfAborted();
      sampleDocuments = await collection
        .aggregate([{ $sample: { size: sampleSize } }])
        .toArray();
    } catch (sampleError) {
      // Fallback to sequential scan if $sample is not available
      console.warn(
        `$sample aggregation failed for ${collectionName}, falling back to sequential scan: ${sampleError}`,
      );
      signal?.throwIfAborted();
      sampleDocuments = await collection.find({}).limit(sampleSize).toArray();
    }

    // Get indexes for the collection
    signal?.throwIfAborted();
    const indexes = await collection.indexes();

    // Infer schema from samples
    const inferredSchema = inferSchemaFromSamples(sampleDocuments);

    // Get document count with timeout protection
    let documentCount: number | string | null = null;
    try {
      // Set a timeout for the count operation
      signal?.throwIfAborted();
      documentCount = await Promise.race([
        collection.countDocuments(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Count operation timed out")),
            5000,
          ),
        ),
      ]);
    } catch (countError) {
      console.warn(
        `Count operation failed or timed out for ${collectionName}: ${countError}`,
      );
      // Estimate count based on sample size and collection stats
      try {
        signal?.throwIfAborted();
        const stats = await db.command({ collStats: collectionName });
        documentCount = stats.count;
      } catch {
        documentCount = "unknown (count operation timed out)";
      }
    }

    const schema: CollectionSchema = {
      type: "collection",
      name: collectionName,
      fields: inferredSchema.fields,
      indexes: indexes.map((idx: IndexDescriptionInfo) => ({
        name: idx.name,
        keys: idx.key,
      })),
      documentCount: documentCount,
      sampleSize: sampleDocuments.length,
      lastUpdated: new Date().toISOString(),
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
  signal,
}: {
  request: ListResourcesRequest;
  client: MongoClient;
  db: Db;
  isReadOnlyMode: boolean;
  signal?: AbortSignal;
}) {
  try {
    signal?.throwIfAborted();
    const collections = await db.listCollections().toArray();

    const allResources = collections.map((collection: CollectionInfo) => ({
      uri: `mongodb:///${collection.name}`,
      mimeType: "application/json",
      name: collection.name,
      description: `MongoDB collection: ${collection.name}`,
    }));

    const cursor = request.params?.cursor;
    const { items, nextCursor } = paginate(allResources, cursor);

    return {
      resources: items,
      ...(nextCursor ? { nextCursor } : {}),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to list collections: ${error.message}`);
    }
    throw new Error("Failed to list collections: Unknown error");
  }
}
