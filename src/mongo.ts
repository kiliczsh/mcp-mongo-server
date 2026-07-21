import { type Db, MongoClient } from "mongodb";

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
    // Read-only mode is enforced at the application layer (write tools and
    // aggregation write/JS operators are rejected). It must not set a
    // readPreference: that provides no write protection and breaks single-node
    // replica sets, where selecting a secondary times out.
    const client = new MongoClient(url);
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
