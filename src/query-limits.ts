export interface QueryLimits {
  documents?: number;
  bytes?: number;
  timeoutMS?: number;
}

export function readQueryLimits(env: NodeJS.ProcessEnv): QueryLimits {
  function positiveInteger(key: string): number | undefined {
    const raw = env[key];
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
    return value;
  }
  const bytes = positiveInteger("MCP_MONGODB_MAX_RESULT_BYTES");
  if (bytes === 1) {
    throw new Error("MCP_MONGODB_MAX_RESULT_BYTES must be at least 2 bytes");
  }
  return {
    documents: positiveInteger("MCP_MONGODB_MAX_RESULT_DOCUMENTS"),
    bytes,
    timeoutMS: positiveInteger("MCP_MONGODB_QUERY_TIMEOUT_MS"),
  };
}

interface ResultCursor<T> {
  next(): Promise<T | null>;
  close(): Promise<void>;
}

export async function readResultPage<T>(
  cursor: ResultCursor<T>,
  limits: Pick<QueryLimits, "documents" | "bytes">,
  pageSize = Infinity,
  signal?: AbortSignal,
): Promise<{
  results: T[];
  hasMore: boolean;
  truncated?: "documents" | "bytes";
}> {
  const results: T[] = [];
  const documentCap = limits.documents ?? Infinity;
  const maxRows = Math.min(documentCap, pageSize);
  let bytes = 2; // JSON array brackets
  try {
    while (true) {
      signal?.throwIfAborted();
      const row = await cursor.next();
      signal?.throwIfAborted();
      if (row === null) return { results, hasMore: false };
      if (results.length === maxRows) {
        return {
          results,
          hasMore: true,
          ...(documentCap < pageSize ? { truncated: "documents" } : {}),
        };
      }
      if (limits.bytes !== undefined) {
        bytes +=
          Buffer.byteLength(JSON.stringify(row), "utf8") +
          (results.length ? 1 : 0);
        if (bytes > limits.bytes) {
          if (!results.length) {
            throw new Error(
              "First result exceeds the byte limit. Use a narrower projection or pipeline.",
            );
          }
          return { results, hasMore: true, truncated: "bytes" };
        }
      }
      results.push(row);
    }
  } finally {
    // The driver may already have closed the cursor on an error or cancellation.
    await cursor.close();
  }
}
