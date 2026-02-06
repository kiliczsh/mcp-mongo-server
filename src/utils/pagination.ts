const DEFAULT_PAGE_SIZE = 20;

interface CursorData {
  offset: number;
}

/**
 * Encodes an offset into an opaque base64 cursor string
 */
export function encodeCursor(offset: number): string {
  const data: CursorData = { offset };
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

/**
 * Decodes a cursor string back to an offset.
 * Returns 0 if cursor is undefined, empty, or invalid.
 */
export function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const data: CursorData = JSON.parse(
      Buffer.from(cursor, "base64").toString("utf-8"),
    );
    return typeof data.offset === "number" && data.offset >= 0
      ? data.offset
      : 0;
  } catch {
    return 0;
  }
}

/**
 * Paginates an array of items using cursor-based pagination.
 * Returns the current page of items and a nextCursor if more items exist.
 */
export function paginate<T>(
  items: T[],
  cursor?: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): { items: T[]; nextCursor?: string } {
  const offset = decodeCursor(cursor);
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize;
  const nextCursor =
    nextOffset < items.length ? encodeCursor(nextOffset) : undefined;
  return { items: page, nextCursor };
}
