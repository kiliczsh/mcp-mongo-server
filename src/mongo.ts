import { MongoClient, ReadPreference, type Db } from "mongodb";

/**
 * Initialize MongoDB connection
 * @param url MongoDB connection string
 * @param readOnly Whether to connect in read-only mode
 * @returns Object containing client, db, connection status, and read-only mode
 */
export async function connectToMongoDB(
  url: string,
  readOnly: boolean,
): Promise<{
  client: MongoClient | null;
  db: Db | null;
  isConnected: boolean;
  isReadOnlyMode: boolean;
}> {
  try {
    const options = readOnly
      ? { readPreference: ReadPreference.SECONDARY }
      : {};

    const client = new MongoClient(url, options);
    await client.connect();
    const db = client.db();

    console.warn(`Connected to MongoDB database: ${db.databaseName}`);

    return {
      client,
      db,
      isConnected: true,
      isReadOnlyMode: readOnly,
    };
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    return {
      client: null,
      db: null,
      isConnected: false,
      isReadOnlyMode: readOnly,
    };
  }
}
