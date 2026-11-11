# Available Tools

## Query Operations

- **query**: Execute MongoDB queries
  ```javascript
  {
    collection: "users",
    filter: { age: { $gt: 30 } },
    projection: { name: 1, email: 1 },
    sort: { _id: 1 },
    limit: 20,
    includeTotal: false
  }
  ```

- **aggregate**: Run aggregation pipelines
  ```javascript
  {
    collection: "orders",
    pipeline: [
      { $match: { status: "completed" } },
      { $group: { _id: "$customerId", total: { $sum: "$amount" } } }
    ]
  }
  ```

- **count**: Count matching documents
  ```javascript
  {
    collection: "products",
    query: { category: "electronics" }
  }
  ```

Use `explain: "queryPlanner"` on `query` or `aggregate` to return an execution plan.
`query.includeTotal: false` omits the exact count and keeps `metadata.hasMore`.
For pagination, use a stable sort with a unique tie-breaker such as `_id`.
Advance `skip` by `metadata.returned` for the next page.

The [result limits](../README.md#environment-variables) are optional positive integers.
The document and byte caps apply to result rows from `query` and `aggregate`.
The byte cap measures the compact UTF-8 `results` array. When a cap cuts a result
short, `metadata.truncated` gives the reason as `documents` or `bytes`. If the first
row exceeds the byte cap, narrow the projection or pipeline and retry.

## Collection Inspection

Both tools take `collection` and optional `connectionId` and `database`.
For example, `{"connectionId":"analytics","database":"mcp_test_secondary","collection":"books"}`.

- **listIndexes** returns index names, ordered keys, and MongoDB index options.
- **collectionSchema** returns inferred fields with sample values, indexes, sample size, and document count using the same inference as the collection resource.

## Write Operations

Use `listConnections` to find targets with `readOnly: false`. If all configured
connections are read-only, tool discovery omits `insert`, `update`, and `createIndex`.

- **update**: Modify documents
  ```javascript
  {
    collection: "posts",
    filter: { _id: "60d21b4667d0d8992e610c85" },
    update: { $set: { title: "Updated Title" } },
    upsert: false,
    multi: false
  }
  ```

- **insert**: Add new documents
  ```javascript
  {
    collection: "comments",
    documents: [
      { author: "user123", text: "Great post!" },
      { author: "user456", text: "Thanks for sharing" }
    ]
  }
  ```

- **createIndex**: Create collection indexes
  ```javascript
  {
    collection: "users",
    indexes: [
      {
        key: { email: 1 },
        unique: true,
        name: "email_unique_idx"
      }
    ]
  }
  ```

## System Operations

- **serverInfo**: Get MongoDB server details
  ```javascript
  {
    includeDebugInfo: true  // Optional
  }
  ```

## Utilities

- **convertTime**: Convert a Unix timestamp or date string to UTC ISO 8601, GMT,
  and Unix seconds/milliseconds, and report the server's current time and
  timezone. Handy for building unambiguous date queries when the server and user
  are in different timezones.
  ```javascript
  // Current server time (omit input)
  {}

  // From a Unix timestamp (seconds or milliseconds, auto-detected)
  { input: 1735732800 }

  // From a date string (with or without a timezone offset)
  { input: "2025-06-15T08:30:00+03:00" }
  ```
