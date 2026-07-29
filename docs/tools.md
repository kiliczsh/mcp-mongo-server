# Available Tools

## Query Operations

- **query**: Execute MongoDB queries
  ```javascript
  {
    collection: "users",
    filter: { age: { $gt: 30 } },
    projection: { name: 1, email: 1 },
    limit: 20,
    explain: "executionStats"  // Optional
  }
  ```

- **aggregate**: Run aggregation pipelines
  ```javascript
  {
    collection: "orders",
    pipeline: [
      { $match: { status: "completed" } },
      { $group: { _id: "$customerId", total: { $sum: "$amount" } } }
    ],
    explain: "queryPlanner"  // Optional
  }
  ```

- **count**: Count matching documents
  ```javascript
  {
    collection: "products",
    query: { category: "electronics" }
  }
  ```

## Write Operations

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
