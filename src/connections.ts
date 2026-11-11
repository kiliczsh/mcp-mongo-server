import { randomUUID } from "node:crypto";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { MongoClient } from "mongodb";

export interface TargetSelectors {
  connectionId?: unknown;
  database?: unknown;
}

interface Connection {
  connectionId: string;
  uri: string;
  selectionTimeout?: number;
  client?: MongoClient;
  defaultDatabase: string;
  databases: string[];
  readOnly: boolean;
  pending?: Promise<MongoClient>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export class Connections {
  readonly cursorScope = randomUUID();
  readonly named: boolean;
  private readonly entries = new Map<string, Connection>();
  private closing?: Promise<void>;

  constructor(
    legacyUri: string,
    configuration: string | undefined,
    readOnly: boolean,
  ) {
    this.named = configuration !== undefined;
    let config: unknown = {};
    if (configuration !== undefined) {
      try {
        config = JSON.parse(configuration);
      } catch {
        throw new Error("MCP_MONGODB_CONNECTIONS must be valid JSON");
      }
    }
    if (!isRecord(config))
      throw new Error("MCP_MONGODB_CONNECTIONS must be an object");
    if (legacyUri && Object.hasOwn(config, "default")) {
      throw new Error("The legacy URI and named default connection conflict");
    }
    const entries = legacyUri
      ? { ...config, default: { uri: legacyUri } }
      : config;
    if (!Object.hasOwn(entries, "default"))
      throw new Error("A default MongoDB connection is required");

    for (const [id, entry] of Object.entries(entries)) {
      if (!/^[A-Za-z0-9_-]+$/.test(id))
        throw new Error("Invalid connection ID");
      if (
        !isRecord(entry) ||
        Object.keys(entry).some(
          (key) => !["uri", "databases", "readOnly"].includes(key),
        )
      ) {
        throw new Error(`Invalid configuration for connection '${id}'`);
      }
      const { uri, databases, readOnly: localReadOnly } = entry;
      if (typeof uri !== "string" || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
        throw new Error(`Invalid MongoDB URI for connection '${id}'`);
      }
      if (localReadOnly !== undefined && typeof localReadOnly !== "boolean") {
        throw new Error(`Invalid readOnly setting for connection '${id}'`);
      }
      let client: MongoClient;
      const query = uri.indexOf("?");
      const uriOptions = new URLSearchParams(
        query < 0 ? "" : uri.slice(query + 1),
      );
      const hasSelectionTimeout = [...uriOptions.keys()].some(
        (key) => key.toLowerCase() === "serverselectiontimeoutms",
      );
      const selectionTimeout =
        this.named && !hasSelectionTimeout ? 5000 : undefined;
      try {
        client = new MongoClient(uri, {
          serverSelectionTimeoutMS: selectionTimeout,
        });
      } catch {
        throw new Error(`Invalid MongoDB URI for connection '${id}'`);
      }
      const defaultDatabase = client.db().databaseName;
      if (
        databases !== undefined &&
        (!Array.isArray(databases) ||
          !databases.includes(defaultDatabase) ||
          databases.some(
            (name) =>
              typeof name !== "string" ||
              !name.trim() ||
              /[/\\. "$]/.test(name) ||
              name.includes("\0"),
          ))
      ) {
        throw new Error(`Invalid database allowlist for connection '${id}'`);
      }
      this.entries.set(id, {
        connectionId: id,
        uri,
        selectionTimeout,
        client,
        defaultDatabase,
        databases:
          databases === undefined
            ? [defaultDatabase]
            : [...new Set(databases as string[])].sort(),
        readOnly: readOnly || localReadOnly === true,
      });
    }
  }

  private connection(id: unknown = "default"): Connection {
    const entry = typeof id === "string" ? this.entries.get(id) : undefined;
    if (!entry) throw new Error("Unknown or invalid MongoDB connection ID");
    return entry;
  }

  list() {
    return [...this.entries.keys()].sort().map((id) => {
      const { connectionId, defaultDatabase, readOnly } = this.connection(id);
      return { connectionId, defaultDatabase, readOnly };
    });
  }

  allowedDatabases(id?: unknown): readonly string[] {
    return this.connection(id).databases;
  }

  async resolve({ connectionId, database }: TargetSelectors = {}) {
    const entry = this.connection(connectionId);
    const name = database === undefined ? entry.defaultDatabase : database;
    if (typeof name !== "string" || !entry.databases.includes(name)) {
      throw new Error(
        `Database is invalid or not allowed on connection '${entry.connectionId}'`,
      );
    }
    if (this.closing) throw new Error("MongoDB connections are shutting down");
    if (!entry.pending) {
      const client =
        entry.client ??
        new MongoClient(entry.uri, {
          serverSelectionTimeoutMS: entry.selectionTimeout,
        });
      entry.client = client;
      entry.pending = client.connect().catch(async () => {
        await client.close().catch(() => undefined);
        entry.client = undefined;
        entry.pending = undefined;
        throw new Error(
          `Failed to connect to MongoDB connection '${entry.connectionId}'`,
        );
      });
    }
    const client = await entry.pending;
    return {
      client,
      db: client.db(name),
      isReadOnlyMode: entry.readOnly,
      connectionId: entry.connectionId,
    };
  }

  async listDatabases(connectionId?: unknown): Promise<string[]> {
    const { db } = await this.resolve({ connectionId });
    const allowed = this.allowedDatabases(connectionId);
    const { databases } = await db.admin().listDatabases({
      nameOnly: true,
      authorizedDatabases: true,
      filter: { name: { $in: [...allowed] } },
    });
    return databases
      .map(({ name }) => name)
      .filter((name) => allowed.includes(name))
      .sort();
  }

  async close(): Promise<void> {
    this.closing ??= Promise.allSettled(
      [...this.entries.values()].map(async ({ client, pending }) => {
        await pending?.catch(() => undefined);
        await client?.close();
      }),
    ).then(() => undefined);
    await this.closing;
  }
}

export function resourceSelectors(uri: string): TargetSelectors {
  let url: URL;
  try {
    url = new URL(uri);
    if (url.protocol !== "mongodb:") throw new Error("Invalid scheme");
    decodeURIComponent(url.search);
  } catch {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      "Invalid MongoDB resource URI",
    );
  }
  const selectors: TargetSelectors = {};
  for (const key of ["connectionId", "database"] as const) {
    const values = url.searchParams.getAll(key);
    if (values.length > 1) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Duplicate resource selector '${key}'`,
      );
    }
    if (values.length === 1) selectors[key] = values[0];
  }
  return selectors;
}
